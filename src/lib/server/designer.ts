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
	return paginateFilteredDeals((stage) => !ACTIVE_VIEW_EXCLUDED_STAGES.has(stage));
}

/**
 * Deals whose Stage is exactly "Project Created" — the dedicated projects view.
 * Stageless deals are NOT included here.
 */
export async function getProjectCreatedDeals(): Promise<DesignerDealSummary[]> {
	return paginateFilteredDeals((stage) => stage === PROJECT_CREATED_STAGE);
}

/**
 * Deals whose Stage is exactly "On Hold" — the dedicated on-hold view.
 * Stageless deals are NOT included here.
 */
export async function getOnHoldDeals(): Promise<DesignerDealSummary[]> {
	return paginateFilteredDeals((stage) => stage === ON_HOLD_STAGE);
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
export async function createDealNote(dealId: string, content: string): Promise<DesignerNote> {
	if (typeof content !== 'string' || content.trim() === '') {
		throw new Error('Note content is required.');
	}
	const ctx = await resolveAdminZohoContext();
	const body = {
		data: [
			{
				Note_Title: 'Designer Note',
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
export type DesignerDashboardScope = 'active' | 'project-created' | 'on-hold';

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
	return {
		id: String(raw?.id ?? ''),
		Note_Title: raw?.Note_Title ?? null,
		Note_Content: raw?.Note_Content ?? null,
		Created_Time: raw?.Created_Time ?? null,
		Modified_Time: raw?.Modified_Time ?? null,
		owner_name: raw?.Owner?.name ?? raw?.Created_By?.name ?? null
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
