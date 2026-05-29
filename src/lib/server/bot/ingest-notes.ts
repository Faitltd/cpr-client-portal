import { createHash } from 'crypto';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { chunkText, embed } from './embeddings';

export interface NotesSyncResult {
	dealId: string;
	processed: number;
	inserted: number;
	skipped: number;
	error?: string;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
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
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
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
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function pickString(v: unknown): string | null {
	if (typeof v === 'string') return v.trim() || null;
	if (v && typeof v === 'object' && 'name' in (v as Record<string, unknown>)) {
		const name = (v as Record<string, unknown>).name;
		return typeof name === 'string' ? name : null;
	}
	return null;
}

function safeIso(value: unknown): string {
	if (typeof value !== 'string' || !value) return new Date().toISOString();
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return new Date().toISOString();
	return d.toISOString();
}

async function ingestOneNote(dealId: string, raw: any): Promise<'inserted' | 'skipped'> {
	const noteId = raw?.id ? String(raw.id) : null;
	if (!noteId) return 'skipped';

	const title = pickString(raw?.Note_Title) ?? '(untitled note)';
	const content = pickString(raw?.Note_Content) ?? '';
	const author =
		pickString(raw?.Owner) ?? pickString(raw?.Created_By) ?? pickString(raw?.Modified_By);
	const occurredAt = safeIso(raw?.Modified_Time ?? raw?.Created_Time);

	const flat = stripHtml(content);
	if (!flat || flat.length < 3) return 'skipped';

	const body = `Title: ${title}\nAuthor: ${author ?? ''}\n\n${flat}`;
	const docRow = {
		deal_id: dealId,
		source: 'zoho_crm_note' as const,
		source_id: `${dealId}:note:${noteId}`,
		source_url: null,
		author,
		occurred_at: occurredAt,
		subject: title,
		body,
		metadata: {
			note_id: noteId,
			created_time: raw?.Created_Time ?? null,
			modified_time: raw?.Modified_Time ?? null,
			parent_module: raw?.$se_module ?? null
		},
		hash: hashBody(body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', 'zoho_crm_note')
		.eq('source_id', docRow.source_id)
		.maybeSingle();

	// Notes are sometimes edited — re-ingest only when content actually changed.
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
	const chunkRows = chunks.map((c, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content: c,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

/**
 * Pull Notes attached to the Deal in Zoho CRM (the "Notes" related list).
 *   GET /Deals/{dealId}/Notes
 * Requires scope: ZohoCRM.modules.notes.READ (covered by ZohoCRM.modules.ALL).
 */
export async function syncNotesForDeal(dealId: string): Promise<NotesSyncResult> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const res: NotesSyncResult = { dealId, processed: 0, inserted: 0, skipped: 0 };

	let page = 1;
	const MAX_PAGES = 10;
	while (page <= MAX_PAGES) {
		let body: any;
		try {
			body = await zohoApiCall(
				accessToken,
				`/Deals/${encodeURIComponent(dealId)}/Notes?page=${page}&per_page=200`,
				{},
				apiDomain
			);
		} catch (err) {
			res.error = err instanceof Error ? err.message : 'CRM notes fetch failed';
			break;
		}

		const items: any[] = Array.isArray(body?.data)
			? body.data
			: Array.isArray(body)
				? body
				: [];
		if (items.length === 0) break;

		for (const item of items) {
			res.processed += 1;
			try {
				const status = await ingestOneNote(dealId, item);
				if (status === 'inserted') res.inserted += 1;
				else res.skipped += 1;
			} catch (err) {
				res.skipped += 1;
				console.warn(
					`[bot/ingest-notes] failed:`,
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
