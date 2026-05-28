import { createHash } from 'crypto';
import {
	getZohoTokens,
	getZohoTokenByUserId,
	supabase,
	upsertZohoTokens,
	type ZohoTokens
} from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { chunkText, embed } from './embeddings';

export interface CrmEmailSyncResult {
	dealId: string;
	processed: number;
	inserted: number;
	skipped: number;
	error?: string;
}

async function refreshIfNeeded(
	tokens: ZohoTokens
): Promise<{ accessToken: string; apiDomain?: string }> {
	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			user_email: tokens.user_email ?? null
		});
	}
	return { accessToken, apiDomain };
}

async function getPrimaryAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	return refreshIfNeeded(tokens);
}

async function getOwnerAccessToken(
	ownerId: string | null
): Promise<{ accessToken: string; apiDomain?: string } | null> {
	if (!ownerId) return null;
	const tokens = await getZohoTokenByUserId(ownerId);
	if (!tokens) return null;
	try {
		return await refreshIfNeeded(tokens);
	} catch (err) {
		console.warn(
			`[bot/ingest-crm-emails] refresh failed for user ${ownerId}:`,
			err instanceof Error ? err.message : err
		);
		return null;
	}
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

function stripHtml(s: string): string {
	return s
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function pickEmailAddr(v: unknown): string | null {
	if (!v) return null;
	if (typeof v === 'string') return v;
	if (typeof v === 'object' && 'email' in (v as Record<string, unknown>)) {
		const e = (v as any).email;
		return typeof e === 'string' ? e : null;
	}
	return null;
}

function joinAddrs(list: unknown): string | null {
	if (!Array.isArray(list)) return pickEmailAddr(list);
	const addrs = list.map(pickEmailAddr).filter(Boolean);
	return addrs.length ? addrs.join(', ') : null;
}

/**
 * Fetch full body of one CRM email. The only URL pattern that's actually
 * exposed in CRM v8 is /Deals/{dealId}/Emails/{messageId}, and even that
 * requires the OWNER's token (or admin equivalent).
 */
async function fetchEmailContent(
	accessToken: string,
	apiDomain: string | undefined,
	messageId: string,
	dealId: string
): Promise<string | null> {
	const attempts = [
		`/Deals/${encodeURIComponent(dealId)}/Emails/${encodeURIComponent(messageId)}`,
		`/Emails/${encodeURIComponent(messageId)}/actions/sent`,
		`/Emails/${encodeURIComponent(messageId)}/actions/received`,
		`/Emails/${encodeURIComponent(messageId)}`
	];
	for (const path of attempts) {
		try {
			const body = await zohoApiCall(accessToken, path, {}, apiDomain);
			// Common shapes:
			//   { Emails: [{ content: "...html..." }] }
			//   { data: [{ content: "..." }] }
			//   { content: "..." }
			const candidates: any[] = [];
			if (Array.isArray(body?.Emails)) candidates.push(...body.Emails);
			if (Array.isArray(body?.data)) candidates.push(...body.data);
			candidates.push(body);
			for (const c of candidates) {
				if (!c) continue;
				const html =
					(typeof c.content === 'string' && c.content) ||
					(typeof c.body === 'string' && c.body) ||
					(typeof c.email_content === 'string' && c.email_content) ||
					(typeof c.htmlContent === 'string' && c.htmlContent) ||
					'';
				if (html) return html;
			}
		} catch {
			/* try next */
		}
	}
	return null;
}

async function ingestOneEmail(
	dealId: string,
	raw: any,
	primary: { accessToken: string; apiDomain?: string }
): Promise<'inserted' | 'skipped'> {
	const messageId =
		raw.message_id ?? raw.id ?? raw.email_id ?? raw.original_message_id ?? null;
	if (!messageId) return 'skipped';

	const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '(no subject)';
	const fromAddr = pickEmailAddr(raw.from ?? raw.sender);
	const toAddr = joinAddrs(raw.to ?? raw.recipients);
	const ccAddr = joinAddrs(raw.cc);
	const sentTime = raw.time ?? raw.sent_time ?? raw.date_time ?? raw.created_time ?? raw.email_time;
	const occurredAt = (() => {
		if (!sentTime) return new Date().toISOString();
		const d = new Date(sentTime);
		if (Number.isNaN(d.getTime())) return new Date().toISOString();
		return d.toISOString();
	})();

	const ownerId = raw.owner?.id ? String(raw.owner.id) : null;
	const ownerName = raw.owner?.name ?? null;

	const sourceIdEarly = `${dealId}:crm:${messageId}`;
	const { data: existingEarly } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', 'zoho_mail')
		.eq('source_id', sourceIdEarly)
		.maybeSingle();

	// Already ingested? Skip the body re-fetch entirely. Emails are immutable
	// — message_id never points to different content over time.
	if (existingEarly) {
		return 'skipped';
	}

	let contentHtml =
		(typeof raw.content === 'string' && raw.content) ||
		(typeof raw.body === 'string' && raw.body) ||
		'';

	// Body fetch: Zoho requires the email's OWNER token to read content. Try
	// the owner's token first, then fall back to the primary.
	if (!contentHtml) {
		const ownerTok = await getOwnerAccessToken(ownerId);
		const useTok = ownerTok ?? primary;
		const fetched = await fetchEmailContent(
			useTok.accessToken,
			useTok.apiDomain,
			String(messageId),
			dealId
		);
		if (fetched) contentHtml = fetched;
	}
	if (!contentHtml && typeof raw.summary === 'string') contentHtml = raw.summary;

	const flat = stripHtml(contentHtml);
	const body =
		`Subject: ${subject}\nFrom: ${fromAddr ?? ''}\nTo: ${toAddr ?? ''}\n` +
		(ccAddr ? `Cc: ${ccAddr}\n` : '') +
		(flat ? `\n${flat}` : '\n(body not available)');

	const docRow = {
		deal_id: dealId,
		source: 'zoho_mail' as const,
		source_id: `${dealId}:crm:${messageId}`,
		source_url: null,
		author: fromAddr,
		occurred_at: occurredAt,
		subject,
		body,
		metadata: {
			origin: 'crm_related_list',
			to: toAddr,
			cc: ccAddr,
			crm_email_id: String(messageId)
		},
		hash: hashBody(body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', 'zoho_mail')
		.eq('source_id', docRow.source_id)
		.maybeSingle();
	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(body, 1500, 200);
	if (chunks.length === 0) return 'inserted';
	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

/**
 * Pull emails linked to the Deal in Zoho CRM (the "Emails" related list).
 *   GET /Deals/{dealId}/Emails
 * Requires scope: ZohoCRM.modules.ALL (which we already have).
 */
export async function syncCrmEmailsForDeal(dealId: string): Promise<CrmEmailSyncResult> {
	const primary = await getPrimaryAccessToken();
	const { accessToken, apiDomain } = primary;
	const res: CrmEmailSyncResult = { dealId, processed: 0, inserted: 0, skipped: 0 };

	let page = 1;
	const MAX_PAGES = 10;
	while (page <= MAX_PAGES) {
		let body: any;
		try {
			body = await zohoApiCall(
				accessToken,
				`/Deals/${encodeURIComponent(dealId)}/Emails?page=${page}&per_page=200`,
				{},
				apiDomain
			);
		} catch (err) {
			res.error = err instanceof Error ? err.message : 'CRM emails fetch failed';
			break;
		}
		const items: any[] = Array.isArray(body?.Emails)
			? body.Emails
			: Array.isArray(body?.data)
				? body.data
				: Array.isArray(body)
					? body
					: [];
		if (items.length === 0) break;
		if (page === 1 && items.length > 0) {
			console.log(
				`[bot/ingest-crm-emails] first item keys for deal ${dealId}:`,
				Object.keys(items[0]).join(', ')
			);
		}
		for (const item of items) {
			res.processed += 1;
			try {
				const status = await ingestOneEmail(dealId, item, primary);
				if (status === 'inserted') res.inserted += 1;
				else res.skipped += 1;
			} catch (err) {
				res.skipped += 1;
				console.warn(
					`[bot/ingest-crm-emails] failed:`,
					err instanceof Error ? err.message : err
				);
			}
		}
		const moreRecords = body?.info?.more_records;
		if (!moreRecords || items.length < 200) break;
		page += 1;
	}

	return res;
}
