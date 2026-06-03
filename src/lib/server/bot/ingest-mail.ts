import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';
import {
	supabase,
	getZohoTokens,
	listZohoTokens,
	upsertZohoTokens,
	type ZohoTokens
} from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	listOrgMailAccounts,
	listMyMailAccounts,
	listAccountFolders,
	listFolderMessages,
	flattenMailBody,
	type ZohoMailAccount,
	type ZohoMailMessageSummary,
	type ZohoMailFolder
} from '$lib/server/zoho-mail';
import { chunkText, embed } from './embeddings';

const PAGE_LIMIT = 200;
const MAX_PAGES_PER_ACCOUNT_PER_RUN = Number(env.BOT_MAIL_MAX_PAGES ?? '2');
const DEFAULT_BACKFILL_DAYS = Number(env.BOT_MAIL_BACKFILL_DAYS ?? '30');
const CURSOR_SOURCE = 'zoho_mail';

export interface MailSyncResult {
	dealId: string;
	dealName: string | null;
	contactEmail: string | null;
	accounts: AccountSyncResult[];
	scope: 'org' | 'personal';
	scopeNote?: string;
	error?: string;
}

export interface AccountSyncResult {
	accountId: string;
	mailbox: string;
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

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	return refreshIfNeeded(tokens);
}

async function fetchDealContact(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<{ dealName: string | null; contactEmail: string | null }> {
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,Contact_Name,Email,Email_1`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const dealName = typeof rec.Deal_Name === 'string' ? rec.Deal_Name : null;
	// CPR's Deals module uses `Email_1` as the primary contact email field.
	let contactEmail =
		(typeof rec.Email_1 === 'string' && rec.Email_1) ||
		(typeof rec.Email === 'string' && rec.Email) ||
		null;
	const contactRef = rec.Contact_Name;
	const contactId =
		contactRef && typeof contactRef === 'object' && 'id' in contactRef
			? String((contactRef as any).id)
			: null;
	if (!contactEmail && contactId) {
		try {
			const cRes = await zohoApiCall(
				accessToken,
				`/Contacts/${encodeURIComponent(contactId)}?fields=Email`,
				{},
				apiDomain
			);
			const cRec = cRes?.data?.[0] ?? {};
			if (typeof cRec.Email === 'string') contactEmail = cRec.Email;
		} catch {
			/* ignore */
		}
	}
	return { dealName, contactEmail };
}

interface ResolvedAccounts {
	accounts: ZohoMailAccount[];
	scope: 'org' | 'personal';
	scopeNote?: string;
}

async function resolveMailAccounts(accessToken: string): Promise<ResolvedAccounts> {
	// Filter to only the mailboxes we actually have OAuth tokens for. Trying
	// the others returns 401/404 every time and floods the health page.
	const tokens = await listZohoTokens();
	const authorizedEmails = new Set(
		tokens
			.map((t) => (t.user_email ?? '').trim().toLowerCase())
			.filter((e) => e.length > 0)
	);

	const orgId = env.ZOHO_MAIL_ORG_ID;
	if (orgId) {
		const orgRes = await listOrgMailAccounts(accessToken, orgId);
		if (orgRes.ok && orgRes.accounts.length > 0) {
			const filtered =
				authorizedEmails.size > 0
					? orgRes.accounts.filter((a) =>
							authorizedEmails.has(a.primaryEmailAddress.toLowerCase())
						)
					: orgRes.accounts;
			if (filtered.length === 0) {
				console.warn(
					`[bot/ingest-mail] org accounts found but none match authorized tokens (${authorizedEmails.size} tokens). Falling back to personal.`
				);
			} else {
				return { accounts: filtered, scope: 'org' };
			}
		}
		const note = orgRes.ok
			? 'org Mail API returned 0 accounts — re-auth as a CPR Mail admin to access all mailboxes'
			: `org Mail API call failed: ${orgRes.error}`;
		console.warn('[bot/ingest-mail]', note);
		const meRes = await listMyMailAccounts(accessToken);
		if (!meRes.ok) throw new Error(`Mail accounts lookup failed: ${meRes.error}`);
		return { accounts: meRes.accounts, scope: 'personal', scopeNote: note };
	}
	const meRes = await listMyMailAccounts(accessToken);
	if (!meRes.ok) throw new Error(`Mail accounts lookup failed: ${meRes.error}`);
	return { accounts: meRes.accounts, scope: 'personal' };
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

function pickIngestFolders(folders: ZohoMailFolder[]): ZohoMailFolder[] {
	// Only ingest from Inbox and Sent — skip Drafts, Trash, Spam, etc.
	const wanted = new Set(['inbox', 'sent', 'sent items']);
	const out: ZohoMailFolder[] = [];
	for (const f of folders) {
		const lower = f.folderName.toLowerCase();
		if (wanted.has(lower)) {
			out.push(f);
			continue;
		}
		const type = (f.folderType ?? '').toLowerCase();
		if (type === 'inbox' || type === 'sent') out.push(f);
	}
	return out;
}

// Known noise senders: marketing, transactional notifications, vendor blasts.
// Anything matching is dropped at ingest time. Add to this list as needed.
const NOISE_DOMAINS = new Set<string>([
	'samsungusa.com',
	'innovations.samsungusa.com',
	'no-reply@slack.com',
	'noreply@slack.com',
	'members.wayfair.com',
	'email.wayfair.com',
	'wayfair.com',
	'business-updates.facebook.com',
	'facebookmail.com',
	'email.tileshop.com',
	'thetileshop.com',
	'twilio.com',
	'no-reply@twilio.com',
	'noreply.com',
	'mailchimp.com',
	'mailchimpapp.com',
	'createsend.com',
	'sendgrid.net',
	'amazonses.com',
	'amazon.com',
	'amazon.co.uk',
	'linkedin.com',
	'meta.com',
	'instagram.com',
	'youtube.com',
	'docusign.net',
	'hellosign.com',
	'icloud.com'
]);

function isNoiseSender(addr: string | null | undefined): boolean {
	if (!addr) return false;
	const lower = addr.toLowerCase().trim();
	if (NOISE_DOMAINS.has(lower)) return true;
	const at = lower.lastIndexOf('@');
	if (at === -1) return false;
	const domain = lower.slice(at + 1);
	if (NOISE_DOMAINS.has(domain)) return true;
	// Also strip subdomains: foo.bar.com → bar.com
	const parts = domain.split('.');
	if (parts.length > 2) {
		const root = parts.slice(-2).join('.');
		if (NOISE_DOMAINS.has(root)) return true;
	}
	if (lower.startsWith('no-reply') || lower.startsWith('noreply') || lower.startsWith('do-not-reply')) {
		return true;
	}
	return false;
}

async function ingestMessage(
	dealId: string,
	mailbox: string,
	accessToken: string,
	accountId: string,
	msg: ZohoMailMessageSummary
): Promise<'inserted' | 'skipped'> {
	if (isNoiseSender(msg.fromAddress) || isNoiseSender(msg.toAddress)) {
		return 'skipped';
	}
	const raw = (msg.summary ?? '').trim();
	const flat = flattenMailBody(raw);
	if (!flat || flat.length < 5) {
		return 'skipped';
	}

	const subject = msg.subject?.trim() || '(no subject)';
	const body = `Subject: ${subject}\nFrom: ${msg.fromAddress ?? ''}\nTo: ${msg.toAddress ?? ''}\n\n${flat}`;
	const occurredAt = new Date(msg.receivedTimeMs).toISOString();

	const docRow = {
		deal_id: dealId,
		source: 'zoho_mail' as const,
		// Prefix with dealId so the same Zoho message can be associated with
		// multiple Deals (e.g. one client with multiple projects, info@
		// blast emails that legitimately match several Deals).
		source_id: `${dealId}:${accountId}:${msg.messageId}`,
		source_url: null,
		author: msg.fromAddress,
		occurred_at: occurredAt,
		subject,
		body,
		metadata: {
			mailbox,
			account_id: accountId,
			folder_id: msg.folderId,
			to: msg.toAddress,
			cc: msg.ccAddress,
			zoho_message_id: msg.messageId
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

async function syncOneAccount(
	dealId: string,
	accessToken: string,
	account: ZohoMailAccount,
	cutoffMs: number,
	contactEmail: string | null
): Promise<AccountSyncResult> {
	const res: AccountSyncResult = {
		accountId: account.accountId,
		mailbox: account.primaryEmailAddress,
		processed: 0,
		inserted: 0,
		skipped: 0
	};

	if (!contactEmail) {
		res.error = 'no contact email';
		return res;
	}

	const foldersRes = await listAccountFolders(accessToken, account.accountId);
	if (!foldersRes.ok) {
		res.error = `folders list failed${foldersRes.status ? ` (HTTP ${foldersRes.status})` : ''}: ${foldersRes.error}`;
		return res;
	}
	const folders = pickIngestFolders(foldersRes.folders);
	if (folders.length === 0) {
		res.error = 'no Inbox/Sent folders found';
		return res;
	}

	const lowerContact = contactEmail.toLowerCase();
	const seenIds = new Set<string>();

	for (const folder of folders) {
		let start = 1;
		let pages = 0;
		let stop = false;
		while (pages < MAX_PAGES_PER_ACCOUNT_PER_RUN && !stop) {
			pages += 1;
			const list = await listFolderMessages(accessToken, account.accountId, folder.folderId, {
				start,
				limit: PAGE_LIMIT
			});
			if (!list.ok) {
				if (!res.error) {
					res.error = `${folder.folderName}: ${list.error.slice(0, 120)}`;
				}
				break;
			}
			if (list.messages.length === 0) break;
			for (const m of list.messages) {
				if (seenIds.has(m.messageId)) continue;
				seenIds.add(m.messageId);
				res.processed += 1;

				// /view returns newest-first; once we cross the cutoff in this
				// folder, stop paging.
				if (m.receivedTimeMs < cutoffMs) {
					stop = true;
					res.skipped += 1;
					continue;
				}

				const fields = [m.fromAddress, m.toAddress, m.ccAddress]
					.filter(Boolean)
					.map((s) => String(s).toLowerCase());
				const hit = fields.some((f) => f.includes(lowerContact));
				if (!hit) {
					res.skipped += 1;
					continue;
				}

				try {
					const status = await ingestMessage(
						dealId,
						account.primaryEmailAddress,
						accessToken,
						account.accountId,
						m
					);
					if (status === 'inserted') res.inserted += 1;
					else res.skipped += 1;
				} catch (err) {
					res.skipped += 1;
					console.warn(
						`[bot/ingest-mail] msg ${m.messageId} failed:`,
						err instanceof Error ? err.message : err
					);
				}
			}
			if (list.messages.length < PAGE_LIMIT) break;
			start += list.messages.length;
		}
	}
	return res;
}

export async function syncMailForDeal(dealId: string): Promise<MailSyncResult> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const { dealName, contactEmail } = await fetchDealContact(accessToken, apiDomain, dealId);
	const sinceMs = DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000;

	const result: MailSyncResult = {
		dealId,
		dealName,
		contactEmail,
		accounts: [],
		scope: 'personal'
	};

	if (!contactEmail) {
		result.error = 'no contact email on Deal — cannot match Mail';
		return result;
	}

	let resolved: ResolvedAccounts;
	try {
		resolved = await resolveMailAccounts(accessToken);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'mail account resolution failed';
		return result;
	}
	result.scope = resolved.scope;
	if (resolved.scopeNote) result.scopeNote = resolved.scopeNote;

	if (resolved.accounts.length === 0) {
		result.error = 'no mail accounts available for this OAuth grant';
		return result;
	}

	const cutoffMs = Date.now() - sinceMs;

	// Build email→token map so each mailbox uses ITS OWN user's token. Zoho
	// Mail per-user privacy means Ray's token can't read MarySue's folders
	// even with org admin; we need MarySue's own grant.
	const tokens = await listZohoTokens();
	const tokenByEmail = new Map<string, ZohoTokens>();
	for (const t of tokens) {
		const e = (t.user_email ?? '').trim().toLowerCase();
		if (e) tokenByEmail.set(e, t);
	}

	for (const account of resolved.accounts) {
		const mailbox = account.primaryEmailAddress.toLowerCase();
		const userTok = tokenByEmail.get(mailbox);
		let acctToken = accessToken;
		let acctDomain = apiDomain;
		if (userTok) {
			try {
				const fresh = await refreshIfNeeded(userTok);
				acctToken = fresh.accessToken;
				acctDomain = fresh.apiDomain;
			} catch (err) {
				console.warn(
					`[bot/ingest-mail] could not refresh token for ${mailbox}:`,
					err instanceof Error ? err.message : err
				);
			}
		}
		result.accounts.push(
			await syncOneAccount(dealId, acctToken, account, cutoffMs, contactEmail)
		);
	}
	return result;
}
