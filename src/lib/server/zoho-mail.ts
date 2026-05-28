import { env } from '$env/dynamic/private';

const DEFAULT_MAIL_BASE = 'https://mail.zoho.com/api';
const MAIL_TIMEOUT_MS = 15_000;

function getMailBase(): string {
	return (env.ZOHO_MAIL_API_BASE || DEFAULT_MAIL_BASE).replace(/\/$/, '');
}

async function mailFetch(
	accessToken: string,
	path: string,
	init: RequestInit = {}
): Promise<{ ok: true; body: any } | { ok: false; status?: number; error: string }> {
	const url = `${getMailBase()}${path}`;
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				Accept: 'application/json',
				...init.headers
			},
			signal: controller.signal
		});
		clearTimeout(timeout);
		const text = await response.text();
		let body: any = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			body = text;
		}
		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				error: typeof body === 'string' ? body : JSON.stringify(body)
			};
		}
		return { ok: true, body };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
	}
}

export interface ZohoMailAccount {
	accountId: string;
	primaryEmailAddress: string;
	displayName: string | null;
	raw: any;
}

function normalizeAccount(raw: any): ZohoMailAccount | null {
	if (!raw || typeof raw !== 'object') return null;
	const accountId = raw.accountId ?? raw.account_id ?? raw.zid ?? null;
	const primaryEmailAddress =
		raw.primaryEmailAddress ?? raw.primary_email_address ?? raw.email ?? null;
	if (!accountId || !primaryEmailAddress) return null;
	return {
		accountId: String(accountId),
		primaryEmailAddress: String(primaryEmailAddress),
		displayName: raw.displayName ?? raw.display_name ?? raw.name ?? null,
		raw
	};
}

/**
 * List all Zoho Mail accounts in the CPR organization. Requires an org-admin
 * OAuth grant with ZohoMail.organization.accounts.READ.
 *
 *   GET {base}/organization/{zoid}/accounts
 */
export async function listOrgMailAccounts(
	accessToken: string,
	orgId: string
): Promise<{ ok: true; accounts: ZohoMailAccount[] } | { ok: false; status?: number; error: string }> {
	const res = await mailFetch(
		accessToken,
		`/organization/${encodeURIComponent(orgId)}/accounts`
	);
	if (!res.ok) return res;
	const data = res.body?.data ?? res.body?.accounts ?? res.body ?? [];
	const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.accounts) ? data.accounts : [];
	const accounts = list.map(normalizeAccount).filter((a): a is ZohoMailAccount => a !== null);
	return { ok: true, accounts };
}

/**
 * Personal account fallback — returns the authorizing user's own account(s).
 *   GET {base}/accounts
 */
export async function listMyMailAccounts(
	accessToken: string
): Promise<{ ok: true; accounts: ZohoMailAccount[] } | { ok: false; status?: number; error: string }> {
	const res = await mailFetch(accessToken, '/accounts');
	if (!res.ok) return res;
	const data = res.body?.data ?? res.body ?? [];
	const list: any[] = Array.isArray(data) ? data : [];
	const accounts = list.map(normalizeAccount).filter((a): a is ZohoMailAccount => a !== null);
	return { ok: true, accounts };
}

export interface ZohoMailMessageSummary {
	messageId: string;
	folderId: string | null;
	subject: string;
	fromAddress: string | null;
	toAddress: string | null;
	ccAddress: string | null;
	receivedTimeMs: number;
	summary: string | null;
	raw: any;
}

function pickTimeMs(raw: any): number | null {
	const candidates = [raw.receivedTime, raw.sentDateInGMT, raw.sentDateGMT, raw.sentDate, raw.date];
	for (const c of candidates) {
		if (c == null) continue;
		if (typeof c === 'number' && Number.isFinite(c)) {
			let n = c;
			if (n < 1e11) n = Math.floor(n * 1000);
			return n;
		}
		if (typeof c === 'string' && c.trim()) {
			if (/^\d+$/.test(c.trim())) return pickTimeMs({ receivedTime: Number(c) });
			const parsed = Date.parse(c);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

function normalizeSearchHit(raw: any): ZohoMailMessageSummary | null {
	if (!raw || typeof raw !== 'object') return null;
	const messageId = raw.messageId ?? raw.message_id ?? raw.msgUid ?? raw.id;
	if (!messageId) return null;
	const time = pickTimeMs(raw);
	if (time == null) return null;
	const folder =
		raw.folderId ?? raw.folder_id ?? raw.folderID ?? raw.fid ?? raw.Fid ?? null;
	const summary =
		(typeof raw.summary === 'string' ? raw.summary : null) ??
		(typeof raw.shortContent === 'string' ? raw.shortContent : null) ??
		(typeof raw.body === 'string' ? raw.body : null);
	return {
		messageId: String(messageId),
		folderId: folder != null ? String(folder) : null,
		subject: typeof raw.subject === 'string' ? raw.subject : '',
		fromAddress: raw.fromAddress ?? raw.sender ?? raw.from ?? null,
		toAddress: raw.toAddress ?? raw.to ?? null,
		ccAddress: raw.ccAddress ?? raw.cc ?? null,
		receivedTimeMs: time,
		summary,
		raw
	};
}

export interface ZohoMailFolder {
	folderId: string;
	folderName: string;
	folderType: string | null;
}

/**
 * List folders in a mailbox.
 *   GET {base}/accounts/{accountId}/folders
 */
export async function listAccountFolders(
	accessToken: string,
	accountId: string
): Promise<{ ok: true; folders: ZohoMailFolder[] } | { ok: false; status?: number; error: string }> {
	const res = await mailFetch(accessToken, `/accounts/${encodeURIComponent(accountId)}/folders`);
	if (!res.ok) return res;
	const list: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
	const folders: ZohoMailFolder[] = [];
	for (const f of list) {
		const id = f.folderId ?? f.folder_id ?? f.id;
		const name = f.folderName ?? f.folder_name ?? f.name;
		if (!id || !name) continue;
		folders.push({
			folderId: String(id),
			folderName: String(name),
			folderType: f.folderType ?? f.folder_type ?? null
		});
	}
	return { ok: true, folders };
}

/**
 * List messages in a folder.
 *   GET {base}/accounts/{accountId}/messages/view?folderId={fid}&start={n}&limit={n}
 */
export async function listFolderMessages(
	accessToken: string,
	accountId: string,
	folderId: string,
	opts: { start?: number; limit?: number } = {}
): Promise<
	| { ok: true; messages: ZohoMailMessageSummary[] }
	| { ok: false; status?: number; error: string }
> {
	const start = String(opts.start ?? 1);
	const limit = String(Math.min(opts.limit ?? 50, 200));
	const url = `/accounts/${encodeURIComponent(accountId)}/messages/view?folderId=${encodeURIComponent(folderId)}&start=${start}&limit=${limit}`;
	const res = await mailFetch(accessToken, url);
	if (!res.ok) return { ...res, error: `URL=${url} :: ${res.error}` };
	const list: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
	const messages = list
		.map(normalizeSearchHit)
		.filter((m): m is ZohoMailMessageSummary => m !== null);
	return { ok: true, messages };
}

/**
 * Search messages in one account by free-form query. Kept for compatibility
 * but currently unreliable due to Zoho DSL ambiguity. Prefer
 * listFolderMessages + in-code filter.
 */
export async function searchAccountMessages(
	accessToken: string,
	accountId: string,
	opts: { query: string; start?: number; limit?: number }
): Promise<
	| { ok: true; messages: ZohoMailMessageSummary[] }
	| { ok: false; status?: number; error: string }
> {
	// Zoho's search expects two query params: searchKey (the FIELD type, e.g.
	// "fromaddress") and searchVariable (the VALUE). The query string we
	// receive has the form "field,value," — split on the first comma.
	const start = String(opts.start ?? 1);
	const limit = String(Math.min(opts.limit ?? 50, 200));

	const firstComma = opts.query.indexOf(',');
	let searchKey = opts.query;
	let searchVariable: string | null = null;
	if (firstComma !== -1) {
		searchKey = opts.query.slice(0, firstComma);
		// Drop a trailing comma if present
		searchVariable = opts.query.slice(firstComma + 1).replace(/,$/, '');
	}

	// Map our internal field names to Zoho's actual ones
	const FIELD_MAP: Record<string, string> = {
		sender: 'fromaddress',
		toCcBcc: 'toaddress',
		subject: 'subject',
		entire: 'subjectandcontent'
	};
	const zohoKey = FIELD_MAP[searchKey] ?? searchKey;

	const enc = (s: string) =>
		s.replace(/@/g, '%40').replace(/&/g, '%26').replace(/\s/g, '%20');

	const qs: string[] = [`searchKey=${enc(zohoKey)}`];
	if (searchVariable) qs.push(`searchVariable=${enc(searchVariable)}`);
	qs.push(`start=${start}`, `limit=${limit}`);

	const url = `/accounts/${encodeURIComponent(accountId)}/messages/search?${qs.join('&')}`;
	console.log(`[zoho-mail] search url account=${accountId}: ${url.slice(0, 250)}`);
	const res = await mailFetch(accessToken, url);
	if (!res.ok) {
		return { ...res, error: `URL=${url} :: ${res.error}` };
	}
	if (!res.ok) return res;
	const list: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
	if (list.length > 0) {
		console.log(
			`[zoho-mail] search hit keys for account ${accountId}:`,
			Object.keys(list[0]).join(', ')
		);
	}
	const messages = list
		.map(normalizeSearchHit)
		.filter((m): m is ZohoMailMessageSummary => m !== null);
	return { ok: true, messages };
}

/**
 * Fetch a single message's body. Zoho Mail content endpoint requires a folder
 * id — search results sometimes include it (`folderId`) and sometimes don't.
 * Caller should pass the folderId hint when available.
 *   GET {base}/accounts/{accountId}/messages/{folderId}/{messageId}/content
 */
export async function getMessageContent(
	accessToken: string,
	accountId: string,
	messageId: string,
	folderId: string
): Promise<{ ok: true; content: string; raw: any } | { ok: false; status?: number; error: string }> {
	const path = `/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`;
	const res = await mailFetch(accessToken, path);
	if (!res.ok) return res;
	const data = res.body?.data ?? res.body;
	const content =
		typeof data === 'string'
			? data
			: typeof data?.content === 'string'
				? data.content
				: typeof data?.body === 'string'
					? data.body
					: typeof data?.htmlContent === 'string'
						? data.htmlContent
						: typeof data?.plainContent === 'string'
							? data.plainContent
							: '';
	return { ok: true, content, raw: data };
}

/**
 * Strip HTML and collapse whitespace from a Mail body.
 */
export function flattenMailBody(html: string): string {
	return html
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
