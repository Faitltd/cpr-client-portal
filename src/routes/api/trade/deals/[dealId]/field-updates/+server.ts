import { json } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_TIMEOUT_MS = 15000;
const FIELD_UPDATE_FIELDS_FULL = ['Note', 'Photo', 'Update_Type', 'Created_Time', 'Modified_Time', 'Name'];
const FIELD_UPDATE_FIELDS_SAFE = ['Note', 'Photo', 'Created_Time', 'Modified_Time', 'Name'];
const FIELD_UPDATE_FIELDS_NOTE_ONLY = ['Note', 'Created_Time', 'Modified_Time', 'Name'];
const FIELD_UPDATES_MODULE_CANDIDATES = (() => {
	const envValue = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
	const base = envValue
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const candidates = new Set<string>([...base, 'Field_Updates']);
	for (let i = 1; i <= 10; i += 1) candidates.add(`Field_Updates${i}`);
	return Array.from(candidates);
})();
const ZOHO_API_BASE = env.ZOHO_API_BASE || '';

function zohoOrigin(apiDomain?: string) {
	if (apiDomain) return apiDomain.replace(/\/$/, '');
	if (ZOHO_API_BASE) {
		try {
			return new URL(ZOHO_API_BASE).origin;
		} catch {
			// ignore
		}
	}
	return 'https://www.zohoapis.com';
}

async function zohoSettingsCall(accessToken: string, endpoint: string, apiDomain?: string) {
	const base = `${zohoOrigin(apiDomain)}/crm/v2`;
	const url = `${base}${endpoint}`;
	const response = await fetch(url, {
		method: 'GET',
		signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS),
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json'
		}
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(text || `Zoho settings call failed (${response.status})`);
	}

	return response.json();
}

function safeDecode(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function getId(value: any): string | null {
	if (!value || typeof value !== 'object') return null;
	return (value.id || value.ID || value.Id || value.record_id || value.recordId || null) as string | null;
}

function addIdCandidate(candidates: Set<string>, value: unknown) {
	if (value === null || value === undefined) return;
	const text = String(value).trim();
	if (!text) return;
	candidates.add(text);
}

function collectIdCandidatesFromValue(value: any, candidates: Set<string>) {
	if (!value) return;
	if (Array.isArray(value)) {
		for (const item of value) {
			collectIdCandidatesFromValue(item, candidates);
		}
		return;
	}
	if (typeof value !== 'object') return;

	addIdCandidate(candidates, value.id);
	addIdCandidate(candidates, value.ID);
	addIdCandidate(candidates, value.Id);
	addIdCandidate(candidates, value.deal_id);
	addIdCandidate(candidates, value.Deal_ID);
	addIdCandidate(candidates, value.record_id);
	addIdCandidate(candidates, value.recordId);
}

function collectDealIdCandidates(deal: any) {
	const candidates = new Set<string>();
	if (!deal || typeof deal !== 'object') return candidates;

	addIdCandidate(candidates, deal.id);
	addIdCandidate(candidates, deal.crm_deal_id);
	addIdCandidate(candidates, deal.source_record_id);
	addIdCandidate(candidates, deal.sourceRecordId);
	addIdCandidate(candidates, deal.deal_id);
	addIdCandidate(candidates, deal.Deal_ID);

	const preferredLookupKeys = [
		'Deal',
		'Deal_Name',
		'Potential_Name',
		'Portal_Deal',
		'Portal_Deals',
		'Portal_Deals1',
		'Portal_Deals2',
		'Portal_Deals3',
		'Active_Deal',
		'Active_Deals',
		'Active_Deals1',
		'Active_Deals2',
		'Active_Deals3',
		'Project',
		'Project_Name'
	];
	for (const key of preferredLookupKeys) {
		collectIdCandidatesFromValue(deal[key], candidates);
	}

	for (const [key, value] of Object.entries(deal)) {
		if (!/(^|_)deals?(\d+)?$/i.test(key) && !/(^|_)project(_name)?$/i.test(key)) continue;
		collectIdCandidatesFromValue(value, candidates);
	}

	return candidates;
}

function isLikelyZohoId(value: string) {
	return /^\d{10,}$/.test(String(value || '').trim());
}

function pickCanonicalDealIdForQuery(deal: any, requestedDealId: string) {
	const preferred: string[] = [];
	if (deal && typeof deal === 'object') {
		preferred.push(
			String(deal.id || '').trim(),
			String(deal.crm_deal_id || '').trim(),
			String(deal.Deal?.id || '').trim(),
			String(deal.Deal_Name?.id || '').trim(),
			String(deal.Potential_Name?.id || '').trim(),
			String(deal.Deal_ID || '').trim(),
			String(deal.deal_id || '').trim()
		);
	}
	for (const id of preferred) {
		if (isLikelyZohoId(id)) return id;
	}

	const candidates = Array.from(collectDealIdCandidates(deal));
	for (const id of candidates) {
		if (isLikelyZohoId(id)) return id;
	}

	if (isLikelyZohoId(requestedDealId)) return requestedDealId;
	return preferred.find(Boolean) || candidates.find(Boolean) || requestedDealId;
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) {
		return date.toISOString();
	}
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.toISOString();
		}
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

type ZohoErrorInfo = {
	code: string | null;
	apiName: string | null;
	message: string | null;
};

function extractZohoErrorInfo(err: unknown): ZohoErrorInfo | null {
	if (!err) return null;
	const message = err instanceof Error ? err.message : String(err);
	const raw = message.replace(/^Zoho API call failed:\s*/i, '').trim();
	if (!raw.startsWith('{')) return null;

	try {
		const parsed = JSON.parse(raw) as any;
		const first = Array.isArray(parsed?.data) ? parsed.data[0] : null;
		if (first && typeof first === 'object') {
			return {
				code: typeof first.code === 'string' ? first.code : null,
				apiName: typeof first?.details?.api_name === 'string' ? first.details.api_name : null,
				message: typeof first.message === 'string' ? first.message : null
			};
		}

		if (parsed && typeof parsed === 'object') {
			return {
				code: typeof parsed.code === 'string' ? parsed.code : null,
				apiName: typeof parsed?.details?.api_name === 'string' ? parsed.details.api_name : null,
				message: typeof parsed.message === 'string' ? parsed.message : null
			};
		}
	} catch {
		// ignore
	}

	return null;
}

function isZohoAccessError(err: unknown) {
	const info = extractZohoErrorInfo(err);
	const code = info?.code;
	if (code === 'ACCESS_DENIED' || code === 'OAUTH_SCOPE_MISMATCH') return true;

	const message = err instanceof Error ? err.message : String(err || '');
	return message.includes('ACCESS_DENIED') || message.includes('OAUTH_SCOPE_MISMATCH');
}

function toSafeClientErrorMessage(err: unknown) {
	const info = extractZohoErrorInfo(err);
	const code = info?.code;
	if (!code) return null;

	if (code === 'ACCESS_DENIED') {
		return 'Zoho CRM returned ACCESS_DENIED for Field Updates. Check the Zoho user/profile that authorized the portal has permission to the Field Updates module and related lists.';
	}

	if (code === 'OAUTH_SCOPE_MISMATCH') {
		return 'Zoho OAuth scope mismatch. Re-authorize at /auth/login with the required Zoho CRM scopes (modules/settings/coql).';
	}

	if (code === 'INVALID_MODULE') {
		return 'Zoho CRM module not found for Field Updates. Confirm the module API name (or set ZOHO_FIELD_UPDATES_MODULE).';
	}

	return null;
}

function isInvalidModuleError(err: unknown) {
	const info = extractZohoErrorInfo(err);
	if (info?.code === 'INVALID_MODULE') return true;
	const message = err instanceof Error ? err.message : String(err || '');
	return message.includes('INVALID_MODULE') || message.includes('INVALID_URL_PATTERN');
}

function isInvalidFieldError(err: unknown) {
	const info = extractZohoErrorInfo(err);
	if (info?.code === 'INVALID_FIELD') return true;
	const message = err instanceof Error ? err.message : String(err || '');
	return message.includes('INVALID_FIELD');
}

function fieldsCsv(fields: string[]) {
	return fields.join(',');
}

function coerceText(value: any): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => coerceText(item))
			.filter(Boolean) as string[];
		return parts.length ? parts.join(', ') : null;
	}
	if (typeof value === 'object') {
		const direct =
			value.display_value ||
			value.displayValue ||
			value.name ||
			value.label ||
			value.value ||
			null;
		if (typeof direct === 'string' && direct.trim()) return direct.trim();
	}
	return null;
}

function pickFirstText(record: Record<string, any>, keys: string[]): string | null {
	for (const key of keys) {
		const value = record?.[key];
		const text = coerceText(value);
		if (text) return text;
	}
	return null;
}

function inferType(record: Record<string, any>): string | null {
	const direct = pickFirstText(record, ['Type_of_Update', 'Update_Type', 'Type', 'UpdateType', 'Update_Type1']);
	if (direct) return direct;

	for (const [key, value] of Object.entries(record || {})) {
		if (!/type/i.test(key)) continue;
		const text = coerceText(value);
		if (text && text.length <= 60) return text;
	}
	return null;
}

type FieldUpdateTimelineItem = {
	id: string;
	createdAt: string | null;
	updatedAt: string | null;
	type: string | null;
	body: string | null;
	photos: Array<{ name: string; url: string }>;
};

function normalizePhotos(value: any, updateId: string) {
	const items: Array<{ name: string; url: string }> = [];
	if (!value) return items;

	const add = (name: string, url: string) => {
		const trimmed = String(url || '').trim();
		if (!trimmed) return;
		items.push({ name: name || 'Photo', url: trimmed });
	};

	const decodeNameFromUrl = (url: string) => {
		const last = String(url).split('?')[0].split('/').filter(Boolean).pop() || '';
		return safeDecode(last) || 'Photo';
	};

	const toProxyUrl = (attachmentId: string, name: string) => {
		const params = new URLSearchParams();
		if (name) params.set('fileName', name);
		const suffix = params.toString() ? `?${params.toString()}` : '';
		return `/api/trade/field-updates/${encodeURIComponent(updateId)}/fields-attachment/${encodeURIComponent(
			attachmentId
		)}${suffix}`;
	};

	const fromObj = (obj: any) => {
		if (!obj || typeof obj !== 'object') return;
		const attachmentId =
			obj.fields_attachment_id ||
			obj.fieldsAttachmentId ||
			obj.attachment_id ||
			obj.attachmentId ||
			obj.file_id ||
			obj.fileId ||
			obj.id ||
			obj.ID ||
			'';
		const url =
			obj.link_url ||
			obj.link ||
			obj.download_url ||
			obj.url ||
			obj.File_Url ||
			obj.File_URL ||
			obj.file_url ||
			obj.fileUrl ||
			obj.href ||
			'';
		const name =
			obj.file_name ||
			obj.File_Name ||
			obj.name ||
			obj.filename ||
			obj.fileName ||
			(url ? decodeNameFromUrl(url) : 'Photo');

		if (attachmentId) {
			add(String(name || 'Photo'), toProxyUrl(String(attachmentId), String(name || 'Photo')));
			return;
		}

		if (url) {
			add(String(name || 'Photo'), String(url));
		}
	};

	if (typeof value === 'string') {
		add(decodeNameFromUrl(value), value);
		return items;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === 'string') add(decodeNameFromUrl(item), item);
			else fromObj(item);
		}
		return items;
	}

	fromObj(value);
	return items;
}

function normalizeFieldUpdate(record: Record<string, any>): FieldUpdateTimelineItem {
	const createdAt = pickFirstText(record, ['Created_Time', 'created_time', 'CreatedTime', 'createdAt', 'created_at']);
	const updatedAt = pickFirstText(record, ['Modified_Time', 'modified_time', 'ModifiedTime', 'updatedAt', 'updated_at']);
	const type = inferType(record);
	const body = pickFirstText(record, ['Note']) || null;

	return {
		id: String(record?.id || ''),
		createdAt: createdAt || null,
		updatedAt: updatedAt || null,
		type: type || null,
		body,
		photos: normalizePhotos(record?.Photo, String(record?.id || ''))
	};
}

type DealRelatedListInfo = { apiName: string; moduleApiName: string | null };

let cachedRelatedListInfo: DealRelatedListInfo | null = null;
let cachedRelatedListFetchedAt = 0;

async function discoverDealRelatedListInfo(
	accessToken: string,
	apiDomain?: string
): Promise<DealRelatedListInfo | null> {
	const ttlMs = 24 * 60 * 60 * 1000;
	if (cachedRelatedListFetchedAt && Date.now() - cachedRelatedListFetchedAt < ttlMs) {
		return cachedRelatedListInfo;
	}

	cachedRelatedListFetchedAt = Date.now();
	cachedRelatedListInfo = null;

	const response = await zohoSettingsCall(
		accessToken,
		`/settings/related_lists?module=${encodeURIComponent('Deals')}`,
		apiDomain
	);

	const lists = (response.related_lists || response.relatedLists || response.data || []) as any[];
	for (const list of lists) {
		const apiName = String(list?.api_name || list?.apiName || '').trim();
		if (!apiName) continue;
		const label = String(list?.display_label || list?.displayLabel || list?.name || '').toLowerCase();
		const moduleRaw = list?.module || list?.module_name || list?.moduleName || null;
		const moduleApiName =
			typeof moduleRaw === 'string'
				? moduleRaw.trim() || null
				: String(
						moduleRaw?.api_name ||
							moduleRaw?.apiName ||
							moduleRaw?.name ||
							moduleRaw?.module ||
							''
					).trim() || null;
		const moduleName = String(moduleApiName || '').toLowerCase();
		if (/field[_ ]?updates?/i.test(apiName) || label.includes('field update') || /field[_ ]?updates?/i.test(moduleName)) {
			cachedRelatedListInfo = { apiName, moduleApiName };
			return cachedRelatedListInfo;
		}
	}

	return null;
}

const cachedDealLookupFieldByModule = new Map<string, { fetchedAt: number; value: string | null }>();

async function discoverFieldUpdatesDealLookupField(
	accessToken: string,
	moduleApiName: string,
	apiDomain?: string
): Promise<string | null> {
	const ttlMs = 24 * 60 * 60 * 1000;
	const cacheKey = `${apiDomain || 'default'}:${moduleApiName}`;
	const cached = cachedDealLookupFieldByModule.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < ttlMs) {
		return cached.value;
	}

	let response: any;
	try {
		response = await zohoSettingsCall(
			accessToken,
			`/settings/fields?module=${encodeURIComponent(moduleApiName)}`,
			apiDomain
		);
	} catch {
		cachedDealLookupFieldByModule.set(cacheKey, { fetchedAt: Date.now(), value: null });
		return null;
	}

	const fields = (response.fields || response.data || []) as any[];
	for (const field of fields) {
		const apiName = String(field?.api_name || field?.apiName || '').trim();
		if (!apiName) continue;

		const dataType = String(field?.data_type || field?.dataType || field?.json_type || '')
			.toLowerCase()
			.trim();
		const label = String(field?.field_label || field?.display_label || field?.fieldLabel || '')
			.toLowerCase()
			.trim();

		const lookup = field?.lookup || field?.lookup_details || field?.lookupDetails || null;
		const lookupModule =
			lookup?.module?.api_name ||
			lookup?.module?.apiName ||
			lookup?.module ||
			lookup?.module_name ||
			lookup?.moduleName ||
			lookup?.module_api_name ||
			lookup?.moduleApiName ||
			null;
		const lookupModuleName = String(lookupModule || '').toLowerCase();

		if (dataType.includes('lookup') && lookupModuleName.includes('deals')) {
			cachedDealLookupFieldByModule.set(cacheKey, { fetchedAt: Date.now(), value: apiName });
			return apiName;
		}

		// Fallback: a deal-ish lookup field even if lookup metadata is missing.
		if (dataType.includes('lookup') && label.includes('deal')) {
			cachedDealLookupFieldByModule.set(cacheKey, { fetchedAt: Date.now(), value: apiName });
			return apiName;
		}
	}

	cachedDealLookupFieldByModule.set(cacheKey, { fetchedAt: Date.now(), value: null });
	return null;
}

async function tradePartnerCanAccessDeal(
	accessToken: string,
	dealId: string,
	tradePartnerId: string,
	apiDomain?: string
): Promise<boolean> {
	// Fast path: load the single deal and verify the lookup contains the partner ID.
	try {
		const response = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent('Portal_Trade_Partners')}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		const deal = response.data?.[0];
		const field = deal?.Portal_Trade_Partners;
		if (Array.isArray(field)) {
			const match = field.some((item: any) => String(item?.id) === String(tradePartnerId));
			if (match) return true;
		}
		if (field && typeof field === 'object') {
			const match = String(field?.id) === String(tradePartnerId);
			if (match) return true;
		}
	} catch (err) {
		if (isZohoAccessError(err)) throw err;
		// Fall through.
	}

	// Fallback: a single search query for the partner's deals, then match the id.
	try {
		const criteria = `(Portal_Trade_Partners:equals:${tradePartnerId})`;
		const response = await zohoApiCall(
			accessToken,
			`/Deals/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent('id')}&per_page=200`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		const match = (response.data || []).some((deal: any) => String(deal?.id) === String(dealId));
		if (match) return true;
	} catch (err) {
		if (isZohoAccessError(err)) throw err;
		// Fall through.
	}

	// Robust final check: use the same deal lookup logic used by the dashboard.
	// This covers orgs where Portal_Trade_Partners isn't populated on the Deal.
	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const requested = String(dealId || '').trim();
	return (deals || []).some((deal: any) => collectDealIdCandidates(deal).has(requested));
}

async function resolveAuthorizedDealId(
	accessToken: string,
	requestedDealId: string,
	tradePartnerId: string,
	apiDomain?: string
): Promise<string | null> {
	const requested = String(requestedDealId || '').trim();
	if (!requested) return null;

	if (await tradePartnerCanAccessDeal(accessToken, requested, tradePartnerId, apiDomain)) {
		return requested;
	}

	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	for (const deal of deals || []) {
		const candidates = collectDealIdCandidates(deal);
		if (!candidates.has(requested)) continue;
		return pickCanonicalDealIdForQuery(deal, requested);
	}

	return null;
}

async function fetchFieldUpdatesByIdsWithFields(
	accessToken: string,
	moduleApiName: string,
	ids: string[],
	fields: string[],
	apiDomain?: string
) {
	const unique = Array.from(new Set((ids || []).map((id) => String(id)).filter(Boolean)));
	if (unique.length === 0) return [];

	const results: any[] = [];
	const chunkSize = 100;
	const fieldsParam = fieldsCsv(fields);
	for (let i = 0; i < unique.length; i += chunkSize) {
		const chunk = unique.slice(i, i + chunkSize);
		const response = await zohoApiCall(
			accessToken,
			`/${encodeURIComponent(moduleApiName)}?ids=${chunk.join(',')}&fields=${encodeURIComponent(fieldsParam)}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		results.push(...(response.data || []));
	}

	return results;
}

async function fetchFieldUpdatesByIds(
	accessToken: string,
	moduleApiName: string,
	ids: string[],
	apiDomain?: string
) {
	const fieldAttempts = [FIELD_UPDATE_FIELDS_FULL, FIELD_UPDATE_FIELDS_SAFE, FIELD_UPDATE_FIELDS_NOTE_ONLY];
	let lastErr: unknown = null;
	for (const fields of fieldAttempts) {
		try {
			return await fetchFieldUpdatesByIdsWithFields(accessToken, moduleApiName, ids, fields, apiDomain);
		} catch (err) {
			lastErr = err;
			if (isInvalidFieldError(err)) continue;
			throw err;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error('Failed to fetch Field Updates');
}

async function fetchFieldUpdatesByIdsAnyModule(
	accessToken: string,
	ids: string[],
	moduleCandidates: string[],
	apiDomain?: string
) {
	let lastErr: unknown = null;
	for (const moduleApiName of moduleCandidates) {
		try {
			const data = await fetchFieldUpdatesByIds(accessToken, moduleApiName, ids, apiDomain);
			if (Array.isArray(data) && data.length > 0) return data;
		} catch (err) {
			lastErr = err;
			if (isInvalidModuleError(err)) continue;
		}
	}
	if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	return [];
}

async function fetchRecentFieldUpdates(
	accessToken: string,
	moduleApiName: string,
	apiDomain?: string,
	lookupField?: string | null
) {
	const perPage = 200;
	const fieldAttempts: Array<string | null> = [];
	if (lookupField) {
		fieldAttempts.push(`${fieldsCsv(FIELD_UPDATE_FIELDS_SAFE)},${lookupField}`);
		fieldAttempts.push(`${fieldsCsv(FIELD_UPDATE_FIELDS_NOTE_ONLY)},${lookupField}`);
	}
	fieldAttempts.push(null);

	let lastErr: unknown = null;
	for (const fieldsParam of fieldAttempts) {
		let page = 1;
		let more = true;
		const results: any[] = [];
		try {
			while (more && page <= 10) {
				const params = new URLSearchParams({
					per_page: String(perPage),
					page: String(page)
				});
				if (fieldsParam) params.set('fields', fieldsParam);

				const response = await zohoApiCall(
					accessToken,
					`/${encodeURIComponent(moduleApiName)}?${params.toString()}`,
					{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
					apiDomain
				);
				results.push(...(response.data || []));
				more = Boolean(response.info?.more_records);
				page += 1;
			}
			return results;
		} catch (err) {
			lastErr = err;
			if (fieldsParam && isInvalidFieldError(err)) continue;
			throw err;
		}
	}
	if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	return [];
}

function recordReferencesDeal(
	record: Record<string, any>,
	dealId: string,
	lookupField?: string | null
): boolean {
	if (!record || typeof record !== 'object') return false;
	const target = String(dealId);

	if (lookupField) {
		const value = (record as any)?.[lookupField];
		if (value !== null && value !== undefined) {
			if (typeof value === 'string' || typeof value === 'number') {
				if (String(value) === target) return true;
			} else if (typeof value === 'object') {
				const id = getId(value);
				if (id && String(id) === target) return true;
			}
		}
	}

	const entries = Object.entries(record || {});

	// Prefer fields that are obviously “deal” lookups.
	for (const [key, value] of entries) {
		if (!/deal/i.test(key)) continue;
		if (value === null || value === undefined) continue;

		if (typeof value === 'string' || typeof value === 'number') {
			if (String(value) === target) return true;
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === 'string' || typeof item === 'number') {
					if (String(item) === target) return true;
					continue;
				}
				const id = getId(item);
				if (id && String(id) === target) return true;
			}
			continue;
		}

		if (typeof value === 'object') {
			const id = getId(value);
			if (id && String(id) === target) return true;
		}
	}

	// Fallback: deep scan for a matching lookup id.
	const seen = new Set<any>();
	const walk = (value: any, depth: number): boolean => {
		if (value === null || value === undefined) return false;
		if (depth > 6) return false;
		if (typeof value !== 'object') return false;
		if (seen.has(value)) return false;
		seen.add(value);

		const id = getId(value);
		if (id && String(id) === target) return true;

		if (Array.isArray(value)) {
			return value.some((item) => walk(item, depth + 1));
		}

		return Object.values(value).some((item) => walk(item, depth + 1));
	};

	return walk(record, 0);
}

async function fetchFieldUpdatesForDeal(accessToken: string, dealId: string, apiDomain?: string) {
	const relatedInfo = await discoverDealRelatedListInfo(accessToken, apiDomain).catch(() => null);
	const moduleCandidates = Array.from(
		new Set([relatedInfo?.moduleApiName, ...FIELD_UPDATES_MODULE_CANDIDATES].filter(Boolean))
	) as string[];

	// 1) Attempt related list fetch from the Deal record (best signal, no need to know lookup field).
	const relatedCandidates = Array.from(
		new Set([relatedInfo?.apiName, ...FIELD_UPDATES_MODULE_CANDIDATES].filter(Boolean))
	) as string[];

	for (const related of relatedCandidates) {
		const baseEndpoint = `/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(related)}`;
		try {
			const response = await zohoApiCall(
				accessToken,
				`${baseEndpoint}?per_page=200`,
				{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
				apiDomain
			);
			if (Array.isArray(response.data) && response.data.length > 0) {
				const ids = response.data.map((record: any) => String(record?.id || '')).filter(Boolean) as string[];
				if (ids.length > 0) {
					const hydrateModules = Array.from(
						new Set([relatedInfo?.moduleApiName, related, ...moduleCandidates].filter(Boolean))
					) as string[];
					try {
						const hydrated = await fetchFieldUpdatesByIdsAnyModule(
							accessToken,
							ids,
							hydrateModules,
							apiDomain
						);
						if (hydrated.length > 0) return hydrated;
					} catch {
						// Fall through to returning whatever the related list provided.
					}
				}
				return response.data as any[];
			}
		} catch {
			// Ignore and keep trying candidates.
		}
	}

	// 2) Attempt search queries across module candidates using discovered lookup field + fallbacks.
	const dealFieldFallbacks = [
		'Deal',
		'Deal_Name',
		'Deal_ID',
		'Deals',
		'Portal_Deal',
		'Portal_Deals',
		'Active_Deal',
		'Active_Deals',
		'Project',
		'Project_Name'
	];

	for (const moduleApiName of moduleCandidates) {
		const discoveredLookup = await discoverFieldUpdatesDealLookupField(accessToken, moduleApiName, apiDomain);
		const dealFieldCandidates = Array.from(
			new Set([discoveredLookup, ...dealFieldFallbacks].filter(Boolean))
		) as string[];

		for (const field of dealFieldCandidates) {
			const criteria = `(${field}:equals:${dealId})`;
			try {
				const response = await zohoApiCall(
					accessToken,
					`/${encodeURIComponent(moduleApiName)}/search?criteria=${encodeURIComponent(criteria)}&per_page=200`,
					{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
					apiDomain
				);
				if (Array.isArray(response.data) && response.data.length > 0) {
					const ids = response.data.map((record: any) => String(record?.id || '')).filter(Boolean) as string[];
					if (ids.length > 0) return await fetchFieldUpdatesByIds(accessToken, moduleApiName, ids, apiDomain);
					return response.data as any[];
				}
			} catch (err) {
				if (isInvalidModuleError(err)) break;
				continue;
			}
		}
	}

	// 3) Fallback: list recent Field Updates per module and filter locally.
	for (const moduleApiName of moduleCandidates) {
		const lookupField = await discoverFieldUpdatesDealLookupField(accessToken, moduleApiName, apiDomain);
		try {
			const all = await fetchRecentFieldUpdates(accessToken, moduleApiName, apiDomain, lookupField);
			const matching = all.filter((record) => recordReferencesDeal(record || {}, dealId, lookupField));
			if (matching.length === 0) continue;

			const ids = matching.map((record: any) => String(record?.id || '')).filter(Boolean);
			if (ids.length > 0) {
				try {
					const hydrated = await fetchFieldUpdatesByIds(accessToken, moduleApiName, ids, apiDomain);
					if (hydrated.length > 0) return hydrated;
				} catch {
					// Fall through.
				}
			}

			return matching;
		} catch (err) {
			if (isInvalidModuleError(err)) continue;
			throw err;
		}
	}

	return [];
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return json({ message: 'Invalid session' }, { status: 401 });
	}

	const tradePartnerId = session.trade_partner.zoho_trade_partner_id;
	if (!tradePartnerId) {
		return json({ message: 'Trade partner is missing Zoho ID' }, { status: 400 });
	}

	const dealId = params.dealId;
	if (!dealId) {
		return json({ message: 'Deal ID required' }, { status: 400 });
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		return json({ message: 'Zoho tokens not configured' }, { status: 500 });
	}

	try {
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

		const apiDomain = tokens.api_domain || undefined;
		const resolvedDealId = await resolveAuthorizedDealId(accessToken, dealId, tradePartnerId, apiDomain);
		if (!resolvedDealId) {
			console.warn('Trade field updates access denied', { dealId, tradePartnerId });
			return json({ message: 'Access denied' }, { status: 403 });
		}
		if (resolvedDealId !== dealId) {
			console.info('Trade field updates resolved deal id alias', {
				requestedDealId: dealId,
				resolvedDealId,
				tradePartnerId
			});
		}

		const records = await fetchFieldUpdatesForDeal(accessToken, resolvedDealId, apiDomain);
		const normalized = (records || [])
			.map((record) => normalizeFieldUpdate(record || {}))
			.filter((item) => item.id);

		normalized.sort((a, b) => {
			const aDate = new Date(a.createdAt || a.updatedAt || 0).getTime();
			const bDate = new Date(b.createdAt || b.updatedAt || 0).getTime();
			return bDate - aDate;
		});

		return json({ data: normalized });
	} catch (err) {
		const safeMessage = toSafeClientErrorMessage(err);
		const message = safeMessage || (err instanceof Error ? err.message : 'Failed to fetch field updates');
		console.error('Trade field updates failed', { dealId, tradePartnerId, error: err });
		return json({ message }, { status: safeMessage ? 502 : 500 });
	}
};
