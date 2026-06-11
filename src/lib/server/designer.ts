import { json, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getDesignerSession,
	getSession,
	getZohoTokens,
	upsertZohoTokens,
	type ClientSession,
	type DesignerSession
} from '$lib/server/db';
import { normalizeDealRecord } from '$lib/server/auth';
import { getLatestDesignerNotesBulk } from '$lib/server/designer-notes';
import { getBooksCustomerByEmail, listInvoicesForCustomer } from '$lib/server/books';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { createLogger } from '$lib/server/logger';
import {
	DESIGNER_FETCH_FIELD_KEYS,
	EDITABLE_DEAL_FIELD_KEYS,
	type DesignerDealSummary,
	type DesignerNote
} from '$lib/types/designer';

const log = createLogger('designer');

const ZOHO_REQUEST_TIMEOUT_MS = (() => {
	const parsed = Number(env.ZOHO_REQUEST_TIMEOUT_MS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
})();

/**
 * Deal fields the designer dashboard fetches from Zoho. Derived from the
 * descriptor set in `$lib/types/designer` so the whitelist, the render set,
 * and the fetched field set never drift apart.
 */
export const DESIGNER_DEAL_FIELDS = [...DESIGNER_FETCH_FIELD_KEYS];

// ---------------------------------------------------------------------------
// Session / authorization
// ---------------------------------------------------------------------------

export type PortalPrincipal =
	| { role: 'client'; session: ClientSession }
	| { role: 'designer'; session: DesignerSession };

/**
 * Resolve the `portal_session` cookie to either a client or a designer.
 * Client sessions are checked first to preserve existing behaviour for client logins.
 */
export async function getPortalPrincipal(
	sessionToken: string | null | undefined
): Promise<PortalPrincipal | null> {
	if (!sessionToken) return null;

	const clientSession = await getSession(sessionToken);
	if (clientSession) return { role: 'client', session: clientSession };

	const designerSession = await getDesignerSession(sessionToken);
	if (designerSession) return { role: 'designer', session: designerSession };

	return null;
}

/**
 * Endpoint guard: returns the designer session or a 401/403 Response.
 * Callers should early-return when `response` is present.
 */
export async function requireDesigner(
	cookies: Cookies
): Promise<
	| { ok: true; session: DesignerSession; response?: undefined }
	| { ok: false; response: Response }
> {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal) {
		return { ok: false, response: json({ message: 'Authentication required.' }, { status: 401 }) };
	}
	if (principal.role !== 'designer') {
		return {
			ok: false,
			response: json({ message: 'Designer access required.' }, { status: 403 })
		};
	}
	return { ok: true, session: principal.session };
}

// ---------------------------------------------------------------------------
// Admin Zoho context (internal)
// ---------------------------------------------------------------------------

type AdminZohoContext = {
	accessToken: string;
	apiDomain: string | undefined;
};

function toSafeIso(value: unknown, fallback?: unknown): string {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback !== undefined) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

/**
 * Return a currently-valid admin access token, refreshing and persisting if needed.
 * Throws if no admin tokens have been stored yet (admin must complete OAuth first).
 * Reuses the refresh/persist pattern from `trade-page-data.ts`.
 */
async function resolveAdminZohoContext(): Promise<AdminZohoContext> {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw new Error('No Zoho admin tokens stored. Complete admin OAuth first.');
	}

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain: tokens.api_domain || undefined };
}

/**
 * Wrap a `zohoApiCall` in an AbortSignal-based timeout so a stalled Zoho
 * endpoint cannot hang a Node request indefinitely. Existing trade-side code
 * uses the same 15s default; this mirrors that behaviour for designer routes.
 */
function zohoCall(ctx: AdminZohoContext, endpoint: string, init: RequestInit = {}): Promise<any> {
	return zohoApiCall(
		ctx.accessToken,
		endpoint,
		{ ...init, signal: init.signal ?? AbortSignal.timeout(ZOHO_REQUEST_TIMEOUT_MS) },
		ctx.apiDomain
	);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function pickLookupName(value: any): string | null {
	if (!value) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		return value.name ?? value.display_value ?? value.displayValue ?? value.value ?? value.label ?? null;
	}
	return null;
}

function pickLookupId(value: any): string | null {
	if (!value || typeof value !== 'object') return null;
	return value.id ? String(value.id) : null;
}

function pickAddress(deal: any): string | null {
	if (typeof deal?.Address === 'string' && deal.Address.trim()) return deal.Address.trim();
	const parts = [deal?.Street, deal?.Address_Line_2, deal?.City, deal?.State, deal?.Zip_Code]
		.map((part) => (typeof part === 'string' ? part.trim() : ''))
		.filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Read the existing WorkDrive URL field on a Deal if one is present.
 * Prefers `Client_Portal_Folder` (set by Zoho automation on project start);
 * falls back to `External_Link`. Parsed via the URL constructor so only
 * well-formed http(s) URLs are returned.
 */
export function extractWorkDriveUrl(deal: any): string | null {
	const candidates = [deal?.Client_Portal_Folder, deal?.External_Link];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (!trimmed) continue;
		try {
			const parsed = new URL(trimmed);
			if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
				return parsed.toString();
			}
		} catch {
			// not a valid URL — skip
		}
	}
	return null;
}

/**
 * Reduce the normalized Deal record to exactly the keys the UI descriptor set
 * references, so the wire payload doesn't carry Zoho bookkeeping (`$approved`,
 * `$process_flow`, etc.) or unrelated nested metadata.
 */
function trimToDescriptorFields(normalized: any): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!normalized || typeof normalized !== 'object') return out;
	for (const key of DESIGNER_FETCH_FIELD_KEYS) {
		if (key in normalized) out[key] = normalized[key];
	}
	return out;
}

/**
 * Produce the frontend-friendly shape returned by every deals endpoint.
 */
export function summarizeDeal(raw: any): DesignerDealSummary | null {
	const normalized = normalizeDealRecord(raw);
	const id = normalized?.id ? String(normalized.id) : '';
	if (!id) return null;

	return {
		id,
		name: String(normalized?.Deal_Name ?? `Deal ${id.slice(-6)}`),
		stage: pickLookupName(normalized?.Stage),
		contactName: pickLookupName(normalized?.Contact_Name),
		contactId: pickLookupId(normalized?.Contact_Name),
		accountName: pickLookupName(normalized?.Account_Name),
		accountId: pickLookupId(normalized?.Account_Name),
		address: pickAddress(normalized),
		ballInCourt: pickLookupName(normalized?.Ball_In_Court),
		ballInCourtNote: pickLookupName(normalized?.Ball_In_Court_Note),
		workdriveUrl: extractWorkDriveUrl(normalized),
		modifiedTime: typeof normalized?.Modified_Time === 'string' ? normalized.Modified_Time : null,
		createdTime: typeof normalized?.Created_Time === 'string' ? normalized.Created_Time : null,
		fields: trimToDescriptorFields(normalized)
	};
}

// ---------------------------------------------------------------------------
// Public CRM service — the designer dashboard's backend API
// ---------------------------------------------------------------------------

/**
 * Stages hidden from the main designer dashboard. Matches $lib/server/auth
 * `normalizeStage` convention: lowercased, with any trailing `(n%)` stripped.
 * `project created` lives on its own page, closed-out states are hidden
 * entirely.
 */
const ACTIVE_VIEW_EXCLUDED_STAGES: ReadonlySet<string> = new Set([
	'completed',
	'on hold',
	'lost',
	'project created'
]);

const PROJECT_CREATED_STAGE = 'project created';
const ON_HOLD_STAGE = 'on hold';

function normalizeStageName(raw: unknown): string {
	let value: unknown = raw;
	if (value && typeof value === 'object') {
		value = (value as any).name ?? (value as any).display_value ?? '';
	}
	if (typeof value !== 'string') return '';
	return value
		.trim()
		.toLowerCase()
		.replace(/\s*\(\s*\d+\s*%?\s*\)\s*/g, '')
		.trim();
}

/**
 * Paginated fetch of all Deals, filtering each raw record through
 * `stagePredicate(normalizedStage)`. The predicate receives '' for stageless
 * deals — callers decide whether to include those.
 */
async function paginateFilteredDeals(
	stagePredicate: (normalizedStage: string) => boolean
): Promise<DesignerDealSummary[]> {
	const ctx = await resolveAdminZohoContext();
	const perPage = 200;
	const maxPages = 30;
	const fields = DESIGNER_DEAL_FIELDS.join(',');
	const summaries: DesignerDealSummary[] = [];

	// Zoho only permits sort_by on id, Created_Time, or Modified_Time for Deals
	// (Deal_Name is rejected with INVALID_DATA). We use Modified_Time desc so
	// if we ever hit the 30-page cap we truncate to the most recently active
	// deals rather than a random slice; alphabetical order is then produced by
	// the localeCompare pass below.
	for (let page = 1; page <= maxPages; page += 1) {
		const response = await zohoCall(
			ctx,
			`/Deals?fields=${encodeURIComponent(fields)}&per_page=${perPage}&page=${page}&sort_by=Modified_Time&sort_order=desc`
		);
		const pageData = Array.isArray(response.data) ? response.data : [];
		if (pageData.length === 0) break;
		for (const raw of pageData) {
			if (!stagePredicate(normalizeStageName(raw?.Stage))) continue;
			const summary = summarizeDeal(raw);
			if (summary) summaries.push(summary);
		}

		const hasMore = response.info?.more_records;
		if (hasMore === false) break;
		if (hasMore !== true && pageData.length < perPage) break;
	}

	// Secondary in-JS sort for locale-aware, case-insensitive ordering —
	// Zoho's collation may otherwise group by ASCII (uppercase before lowercase).
	summaries.sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
	);

	return summaries;
}

/**
 * Active deals for the main designer dashboard — hides closed-out stages
 * (Completed, On Hold, Lost) AND Project Created (which lives on its own page).
 * Stageless deals remain visible so WIP records aren't accidentally hidden.
 */
export async function getAllDeals(): Promise<DesignerDealSummary[]> {
	const deals = await paginateFilteredDeals((stage) => !ACTIVE_VIEW_EXCLUDED_STAGES.has(stage));
	return overlayCachedDesignerNotes(deals);
}

/**
 * Deals for the CRM tab — active deals PLUS Project Created, On Hold, and
 * Lost, so the client-side view selector has data for every view. Only
 * Completed stays hidden.
 */
export async function getCrmDeals(): Promise<DesignerDealSummary[]> {
	const deals = await paginateFilteredDeals(
		(stage) =>
			!ACTIVE_VIEW_EXCLUDED_STAGES.has(stage) ||
			stage === PROJECT_CREATED_STAGE ||
			stage === ON_HOLD_STAGE ||
			stage === 'lost'
	);
	return overlayCachedDesignerNotes(deals);
}

/**
 * Deals whose Stage is exactly "Project Created" — the dedicated projects view.
 * Stageless deals are NOT included here.
 */
export async function getProjectCreatedDeals(): Promise<DesignerDealSummary[]> {
	const deals = await paginateFilteredDeals((stage) => stage === PROJECT_CREATED_STAGE);
	return overlayCachedDesignerNotes(deals);
}

/**
 * Deals whose Stage is exactly "On Hold" — the dedicated on-hold view.
 * Stageless deals are NOT included here.
 */
export async function getOnHoldDeals(): Promise<DesignerDealSummary[]> {
	const deals = await paginateFilteredDeals((stage) => stage === ON_HOLD_STAGE);
	return overlayCachedDesignerNotes(deals);
}

/**
 * Stages excluded from the Financials view. Lost deals carry no real money, and
 * the early pre-quote stages below never have invoice/contract figures, so they
 * only add empty rows.
 */
const FINANCIALS_EXCLUDED_STAGES: ReadonlySet<string> = new Set([
	'lost',
	'ballpark needed',
	'ballpark review needed',
	'ballpark review booked',
	'pda needed'
]);

/**
 * Deals for the Financials view — every stage except the financially-empty ones
 * in FINANCIALS_EXCLUDED_STAGES. Covers current/in-progress projects (Project
 * Created), On Hold, and Completed, not just the active pre-construction
 * pipeline shown on the main dashboard. Stageless deals are included so nothing
 * financial is dropped.
 */
export async function getDealsForFinancials(): Promise<DesignerDealSummary[]> {
	const deals = await paginateFilteredDeals((stage) => !FINANCIALS_EXCLUDED_STAGES.has(stage));
	return overlayCachedDesignerNotes(deals);
}

/**
 * Most-recent-edited wins reconciliation between Zoho and the Supabase cache.
 *
 *  • If the cached edit is NEWER than Zoho's Modified_Time → use the cached
 *    value. (Cache is the source of truth until Zoho catches up — a Push to
 *    Zoho will reconcile.)
 *  • If Zoho is newer (someone edited in CRM directly) → use Zoho's value.
 *    The stale cached row stays — it just won't be used.
 *
 * Errors loading the cache are swallowed: we never want a Supabase outage to
 * break the designer dashboard. Worst case: behaviour reverts to pre-cache.
 */
async function overlayCachedDesignerNotes(
	deals: DesignerDealSummary[]
): Promise<DesignerDealSummary[]> {
	if (deals.length === 0) return deals;
	let cache: Awaited<ReturnType<typeof getLatestDesignerNotesBulk>>;
	try {
		cache = await getLatestDesignerNotesBulk(deals.map((d) => d.id));
	} catch (err) {
		log.warn('overlayCachedDesignerNotes: cache lookup failed; continuing without cache', {
			error: err instanceof Error ? err.message : String(err)
		});
		return deals;
	}
	if (cache.size === 0) return deals;
	return deals.map((deal) => {
		const zohoMod = deal.modifiedTime ? new Date(deal.modifiedTime).getTime() : 0;
		let next = deal;
		for (const field of ['Ball_In_Court', 'Ball_In_Court_Note'] as const) {
			const cached = cache.get(`${deal.id}::${field}`);
			if (!cached) continue;
			const editedAt = new Date(cached.edited_at).getTime();
			if (!Number.isFinite(editedAt) || editedAt <= zohoMod) continue;
			// Cache wins.
			next =
				field === 'Ball_In_Court'
					? { ...next, ballInCourt: cached.value }
					: { ...next, ballInCourtNote: cached.value };
		}
		return next;
	});
}

/**
 * Fields requested when reading Notes. Zoho CRM v8 requires an explicit
 * `fields` list on related-list GETs; omitting it returns
 * REQUIRED_PARAM_MISSING {param_name: "fields"}.
 */
const NOTE_FIELDS = ['Note_Title', 'Note_Content', 'Created_Time', 'Modified_Time', 'Owner'].join(
	','
);

/**
 * Fetch Zoho CRM Notes attached to a specific Deal, newest first. Paginated
 * to completion so long histories aren't silently truncated.
 */
export async function getDealNotes(dealId: string): Promise<DesignerNote[]> {
	const ctx = await resolveAdminZohoContext();
	const perPage = 200;
	const maxPages = 10;
	const notes: DesignerNote[] = [];

	for (let page = 1; page <= maxPages; page += 1) {
		const response = await zohoCall(
			ctx,
			`/Deals/${encodeURIComponent(dealId)}/Notes?fields=${encodeURIComponent(NOTE_FIELDS)}&sort_by=Created_Time&sort_order=desc&per_page=${perPage}&page=${page}`
		);
		const rows = Array.isArray(response.data) ? response.data : [];
		if (rows.length === 0) break;
		for (const row of rows) notes.push(mapNote(row));

		const hasMore = response.info?.more_records;
		if (hasMore === false) break;
		if (hasMore !== true && rows.length < perPage) break;
	}

	return notes;
}

/**
 * Create a Zoho CRM Note against a Deal. Zoho stamps `Created_Time` itself —
 * we don't send a timestamp with the request.
 */
export async function createDealNote(
	dealId: string,
	content: string,
	author?: string | null
): Promise<DesignerNote> {
	if (typeof content !== 'string' || content.trim() === '') {
		throw new Error('Note content is required.');
	}
	// All notes are written through the admin Zoho token, so Zoho stamps
	// Created_By as the admin. Designers have no Zoho identity, so we record the
	// real author in the note title (`Designer Note: <name>`) and surface that as
	// the owner in mapNote().
	const trimmedAuthor = typeof author === 'string' ? author.trim() : '';
	const noteTitle = trimmedAuthor ? `Designer Note: ${trimmedAuthor}` : 'Designer Note';
	const ctx = await resolveAdminZohoContext();
	const body = {
		data: [
			{
				Note_Title: noteTitle,
				Note_Content: content,
				Parent_Id: dealId,
				se_module: 'Deals'
			}
		]
	};
	const response = await zohoCall(ctx, `/Deals/${encodeURIComponent(dealId)}/Notes`, {
		method: 'POST',
		body: JSON.stringify(body)
	});

	const row = Array.isArray(response.data) ? response.data[0] : null;
	if (!row || (row.status && row.status !== 'success')) {
		throw new Error(row?.message || 'Zoho rejected the note.');
	}

	const details = row.details || {};
	return mapNote({
		id: details.id,
		Note_Title: body.data[0].Note_Title,
		Note_Content: body.data[0].Note_Content,
		Created_Time: details.Created_Time ?? new Date().toISOString(),
		Modified_Time: details.Modified_Time ?? null,
		Owner: details.Created_By ?? null
	});
}

export type DealUpdateResult =
	| { ok: true; deal: DesignerDealSummary }
	| { ok: false; code: string; message: string };

/**
 * PATCH a Deal in Zoho with the supplied field map. The update is default-deny:
 * only keys listed as `editable: true` in the shared descriptor set are
 * forwarded. Audit fields, lookups, integration IDs and attachment fields are
 * dropped silently (and logged). The updated Deal is re-fetched and returned
 * so the caller gets server-authoritative state without a second round-trip.
 */
export async function updateDeal(
	dealId: string,
	fields: Record<string, unknown>
): Promise<DealUpdateResult> {
	const ctx = await resolveAdminZohoContext();
	const { fields: sanitized, rejected: droppedKeys } = filterToEditable(fields);
	if (droppedKeys.length > 0) {
		log.warn('dropping non-editable field keys from designer PATCH', {
			dealId,
			dropped: droppedKeys
		});
	}
	if (Object.keys(sanitized).length === 0) {
		return {
			ok: false,
			code: 'NO_WRITABLE_FIELDS',
			message:
				'No editable fields supplied. Audit, lookup, and integration fields are not editable from the designer dashboard.'
		};
	}

	const payload = { data: [{ ...sanitized, id: dealId }] };
	const response = await zohoCall(ctx, `/Deals/${encodeURIComponent(dealId)}`, {
		method: 'PUT',
		body: JSON.stringify(payload)
	});

	const row = Array.isArray(response.data) ? response.data[0] : null;
	if (!row) {
		return { ok: false, code: 'NO_RESPONSE', message: 'Zoho returned no rows.' };
	}
	if (row.status && row.status !== 'success') {
		log.warn('Zoho Deal update returned non-success', { dealId, row });
		return {
			ok: false,
			code: row.code ?? 'ZOHO_REJECTED',
			message: row.message || 'Zoho rejected the update.'
		};
	}

	const reloaded = await fetchDealById(ctx, dealId);
	if (!reloaded) {
		return {
			ok: false,
			code: 'RELOAD_FAILED',
			message: 'Deal was updated but could not be reloaded.'
		};
	}
	return { ok: true, deal: reloaded };
}

// ---------------------------------------------------------------------------
// SSR dashboard context (parity with getClientDashboardContext)
// ---------------------------------------------------------------------------

export type DesignerDashboardContext = {
	session: DesignerSession;
	deals: DesignerDealSummary[];
	warning: string;
};

/**
 * Mirrors `getClientDashboardContext`: resolves the session, enforces expiry
 * and role, loads the data the SSR page needs. Returns `null` for any case
 * that should redirect to the login screen. Zoho failures surface via
 * `warning` so the page can render an empty list rather than 500.
 */
export type DesignerDashboardScope = 'active' | 'crm' | 'project-created' | 'on-hold' | 'financials';

export async function getDesignerDashboardContext(
	sessionToken: string | null | undefined,
	scope: DesignerDashboardScope = 'active'
): Promise<DesignerDashboardContext | null> {
	const normalizedToken = typeof sessionToken === 'string' ? sessionToken.trim() : '';
	if (!normalizedToken) return null;

	const principal = await getPortalPrincipal(normalizedToken);
	if (!principal || principal.role !== 'designer') return null;
	if (new Date(principal.session.expires_at) < new Date()) return null;

	let deals: DesignerDealSummary[] = [];
	let warning = '';
	try {
		deals =
			scope === 'project-created'
				? await getProjectCreatedDeals()
				: scope === 'on-hold'
					? await getOnHoldDeals()
					: scope === 'financials'
						? await getDealsForFinancials()
						: scope === 'crm'
							? await getCrmDeals()
							: await getAllDeals();
	} catch (err) {
		warning = err instanceof Error ? err.message : 'Unable to load deals';
		log.warn('getDesignerDashboardContext: deal load failed', { scope, warning });
	}

	return {
		session: principal.session,
		deals,
		warning
	};
}

// ---------------------------------------------------------------------------
// Financials — CRM contract Amount + Zoho Books invoiced/paid.
// Books invoices are keyed by customer (contact email), not by deal, so the
// invoiced/paid figures are the customer's totals. Grand totals dedupe by
// customer so a client with multiple deals isn't counted twice.
// ---------------------------------------------------------------------------

export type DealFinancials = {
	invoiced: number;
	paid: number;
	balance: number;
	invoiceCount: number;
};

export type DealFinancialRow = {
	id: string;
	name: string;
	stage: string | null;
	contactName: string | null;
	contactId: string | null;
	amount: number | null;
	closingDate: string | null;
	email: string | null;
	books: DealFinancials | null;
};

export type DesignerFinancials = {
	rows: DealFinancialRow[];
	totals: {
		contractValue: number;
		invoiced: number;
		paid: number;
		balance: number;
		dealCount: number;
		valuedCount: number;
	};
	booksAvailable: boolean;
	warning: string;
};

function toFinancialAmount(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
	return Number.isFinite(n) ? n : null;
}

async function mapLimited<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const workerCount = Math.min(Math.max(1, limit), items.length || 1);
	const workers = Array.from({ length: workerCount }, async () => {
		while (next < items.length) {
			const idx = next++;
			out[idx] = await fn(items[idx]);
		}
	});
	await Promise.all(workers);
	return out;
}

async function fetchContactEmailsByIds(
	ctx: AdminZohoContext,
	ids: string[]
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const unique = Array.from(new Set(ids.filter(Boolean)));
	const chunkSize = 100;
	for (let i = 0; i < unique.length; i += chunkSize) {
		const chunk = unique.slice(i, i + chunkSize);
		try {
			const response = await zohoCall(ctx, `/Contacts?ids=${chunk.join(',')}&fields=Email`);
			const records = Array.isArray(response?.data) ? response.data : [];
			for (const rec of records) {
				const id = rec?.id ? String(rec.id) : '';
				const email = typeof rec?.Email === 'string' ? rec.Email.trim().toLowerCase() : '';
				if (id && email) map.set(id, email);
			}
		} catch (err) {
			log.warn('Contact email fetch failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}
	return map;
}

async function fetchBooksForEmails(
	accessToken: string,
	emails: string[]
): Promise<Map<string, DealFinancials>> {
	const byEmail = new Map<string, DealFinancials>();
	const unique = Array.from(new Set(emails.filter(Boolean)));
	await mapLimited(unique, 3, async (email) => {
		try {
			const customer = await getBooksCustomerByEmail(accessToken, email);
			const customerId = customer?.contact_id;
			if (!customerId) return;
			const invoices = await listInvoicesForCustomer(accessToken, customerId);
			let invoiced = 0;
			let balance = 0;
			let invoiceCount = 0;
			for (const inv of Array.isArray(invoices) ? invoices : []) {
				invoiced += toFinancialAmount(inv?.total) ?? 0;
				balance += toFinancialAmount(inv?.balance) ?? 0;
				invoiceCount += 1;
			}
			byEmail.set(email, { invoiced, paid: invoiced - balance, balance, invoiceCount });
		} catch (err) {
			log.warn('Books fetch failed for customer', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	});
	return byEmail;
}

function sumContractTotals(rows: DealFinancialRow[]) {
	const totals = {
		contractValue: 0,
		invoiced: 0,
		paid: 0,
		balance: 0,
		dealCount: rows.length,
		valuedCount: 0
	};
	for (const row of rows) {
		if (row.amount !== null) {
			totals.contractValue += row.amount;
			totals.valuedCount += 1;
		}
	}
	return totals;
}

export async function getDealsFinancials(
	deals: DesignerDealSummary[]
): Promise<DesignerFinancials> {
	const rows: DealFinancialRow[] = deals.map((deal) => {
		const fields = (deal.fields ?? {}) as Record<string, unknown>;
		return {
			id: deal.id,
			name: deal.name,
			stage: deal.stage,
			contactName: deal.contactName,
			contactId: deal.contactId,
			amount: toFinancialAmount(fields.Amount),
			closingDate: typeof fields.Closing_Date === 'string' ? fields.Closing_Date : null,
			email: null,
			books: null
		};
	});

	try {
		const ctx = await resolveAdminZohoContext();
		const emailById = await fetchContactEmailsByIds(
			ctx,
			rows.map((row) => row.contactId || '')
		);
		for (const row of rows) {
			row.email = row.contactId ? emailById.get(row.contactId) ?? null : null;
		}

		const booksByEmail = await fetchBooksForEmails(
			ctx.accessToken,
			rows.map((row) => row.email || '')
		);
		for (const row of rows) {
			row.books = row.email ? booksByEmail.get(row.email) ?? null : null;
		}

		const totals = sumContractTotals(rows);
		// Dedupe Books totals by customer so multi-deal clients aren't double counted.
		for (const fin of booksByEmail.values()) {
			totals.invoiced += fin.invoiced;
			totals.paid += fin.paid;
			totals.balance += fin.balance;
		}

		return { rows, totals, booksAvailable: booksByEmail.size > 0, warning: '' };
	} catch (err) {
		const warning = err instanceof Error ? err.message : 'Unable to load Books financials';
		log.warn('getDealsFinancials failed', { warning });
		return { rows, totals: sumContractTotals(rows), booksAvailable: false, warning };
	}
}

export interface BooksInvoiceSummary {
	id: string;
	number: string;
	date: string | null;
	dueDate: string | null;
	status: string | null;
	total: number | null;
	balance: number | null;
}

/**
 * Detailed invoice list for a Books customer (by email) — invoice numbers,
 * dates, status, totals. Backs the Financials drill-down.
 */
export async function listBooksInvoicesForEmail(email: string): Promise<BooksInvoiceSummary[]> {
	const ctx = await resolveAdminZohoContext();
	const customer = await getBooksCustomerByEmail(ctx.accessToken, email);
	const customerId = customer?.contact_id;
	if (!customerId) return [];
	const invoices = await listInvoicesForCustomer(ctx.accessToken, customerId);
	return (Array.isArray(invoices) ? invoices : []).map((inv: any) => ({
		id: String(inv?.invoice_id ?? ''),
		number: String(inv?.invoice_number ?? ''),
		date: typeof inv?.date === 'string' ? inv.date : null,
		dueDate: typeof inv?.due_date === 'string' ? inv.due_date : null,
		status: typeof inv?.status === 'string' ? inv.status : null,
		total: toFinancialAmount(inv?.total),
		balance: toFinancialAmount(inv?.balance)
	}));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchDealById(
	ctx: AdminZohoContext,
	dealId: string
): Promise<DesignerDealSummary | null> {
	const fields = DESIGNER_DEAL_FIELDS.join(',');
	try {
		const response = await zohoCall(
			ctx,
			`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent(fields)}`
		);
		const raw = Array.isArray(response.data) ? response.data[0] : null;
		if (!raw) return null;
		return summarizeDeal(raw);
	} catch (err) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

function filterToEditable(
	updates: Record<string, unknown>
): { fields: Record<string, unknown>; rejected: string[] } {
	const fields: Record<string, unknown> = {};
	const rejected: string[] = [];
	for (const [key, value] of Object.entries(updates)) {
		if (EDITABLE_DEAL_FIELD_KEYS.has(key)) {
			fields[key] = value;
		} else {
			rejected.push(key);
		}
	}
	return { fields, rejected };
}

function mapNote(raw: any): DesignerNote {
	const title = typeof raw?.Note_Title === 'string' ? raw.Note_Title : null;
	// Portal notes carry their real author in the title ("Designer Note: <name>").
	// Fall back to the Zoho record owner for notes created directly in the CRM.
	const authorMatch = title ? title.match(/^Designer Note:\s*(.+)$/) : null;
	const owner_name = authorMatch
		? authorMatch[1].trim()
		: raw?.Owner?.name ?? raw?.Created_By?.name ?? null;
	return {
		id: String(raw?.id ?? ''),
		Note_Title: title,
		Note_Content: raw?.Note_Content ?? null,
		Created_Time: raw?.Created_Time ?? null,
		Modified_Time: raw?.Modified_Time ?? null,
		owner_name
	};
}

/**
 * Detect Zoho errors that should map to a 404 rather than a 500.
 */
export function isNotFoundError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /record not found/i.test(message) || /INVALID_DATA/i.test(message);
}

export function isNoAdminTokensError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /no zoho admin tokens/i.test(message);
}
