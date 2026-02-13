import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_TIMEOUT_MS = 15000;
const FIELD_UPDATE_FIELDS = ['Note', 'Photo', 'Update_Type', 'Created_Time', 'Modified_Time', 'Name'].join(',');
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

		if (url) {
			add(String(name || 'Photo'), String(url));
			return;
		}

		if (attachmentId) {
			add(String(name || 'Photo'), toProxyUrl(String(attachmentId), String(name || 'Photo')));
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

let cachedRelatedListApiName: string | null = null;
let cachedRelatedListFetchedAt = 0;

async function discoverDealRelatedListApiName(accessToken: string, apiDomain?: string): Promise<string | null> {
	const ttlMs = 24 * 60 * 60 * 1000;
	if (cachedRelatedListFetchedAt && Date.now() - cachedRelatedListFetchedAt < ttlMs) {
		return cachedRelatedListApiName;
	}

	cachedRelatedListFetchedAt = Date.now();
	cachedRelatedListApiName = null;

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
		const moduleName = String(list?.module || list?.module_name || list?.moduleName || '').toLowerCase();
		if (/field[_ ]?updates?/i.test(apiName) || label.includes('field update') || /field[_ ]?updates?/i.test(moduleName)) {
			cachedRelatedListApiName = apiName;
			return apiName;
		}
	}

	return null;
}

let cachedDealLookupFieldApiName: string | null = null;
let cachedDealLookupFetchedAt = 0;

async function discoverFieldUpdatesDealLookupField(accessToken: string, apiDomain?: string): Promise<string | null> {
	const ttlMs = 24 * 60 * 60 * 1000;
	if (cachedDealLookupFetchedAt && Date.now() - cachedDealLookupFetchedAt < ttlMs) {
		return cachedDealLookupFieldApiName;
	}

	cachedDealLookupFetchedAt = Date.now();
	cachedDealLookupFieldApiName = null;

	const response = await zohoSettingsCall(
		accessToken,
		`/settings/fields?module=${encodeURIComponent('Field_Updates')}`,
		apiDomain
	);

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
			cachedDealLookupFieldApiName = apiName;
			return apiName;
		}

		// Fallback: a deal-ish lookup field even if lookup metadata is missing.
		if (dataType.includes('lookup') && label.includes('deal')) {
			cachedDealLookupFieldApiName = apiName;
			return apiName;
		}
	}

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
			return field.some((item: any) => String(item?.id) === String(tradePartnerId));
		}
		if (field && typeof field === 'object') {
			return String(field?.id) === String(tradePartnerId);
		}
	} catch {
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
		return (response.data || []).some((deal: any) => String(deal?.id) === String(dealId));
	} catch {
		return false;
	}
}

async function fetchFieldUpdatesByIds(accessToken: string, ids: string[], apiDomain?: string) {
	const unique = Array.from(new Set((ids || []).map((id) => String(id)).filter(Boolean)));
	if (unique.length === 0) return [];

	const results: any[] = [];
	const chunkSize = 100;
	for (let i = 0; i < unique.length; i += chunkSize) {
		const chunk = unique.slice(i, i + chunkSize);
		const response = await zohoApiCall(
			accessToken,
			`/Field_Updates?ids=${chunk.join(',')}&fields=${encodeURIComponent(FIELD_UPDATE_FIELDS)}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		results.push(...(response.data || []));
	}

	return results;
}

async function fetchRecentFieldUpdates(accessToken: string, apiDomain?: string, lookupField?: string | null) {
	const perPage = 200;
	let page = 1;
	let more = true;
	const results: any[] = [];

	while (more && page <= 10) {
		const params = new URLSearchParams({
			per_page: String(perPage),
			page: String(page)
		});
		// If we know the deal lookup API name, include it (plus the fields we want) to avoid huge payloads.
		if (lookupField) {
			params.set('fields', `${FIELD_UPDATE_FIELDS},${lookupField}`);
		}

		const response = await zohoApiCall(
			accessToken,
			`/Field_Updates?${params.toString()}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		results.push(...(response.data || []));
		more = Boolean(response.info?.more_records);
		page += 1;
	}

	return results;
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
	// 1) Attempt related list fetch from the Deal record (best signal, no need to know lookup field).
	const discovered = await discoverDealRelatedListApiName(accessToken, apiDomain).catch(() => null);
	const defaultRelatedCandidates = ['Field_Updates'];
	for (let i = 1; i <= 10; i += 1) defaultRelatedCandidates.push(`Field_Updates${i}`);
	const relatedCandidates = Array.from(
		new Set([discovered, ...defaultRelatedCandidates].filter(Boolean))
	) as string[];

	for (const related of relatedCandidates) {
		const baseEndpoint = `/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(related)}`;
		try {
			const response = await zohoApiCall(
				accessToken,
				`${baseEndpoint}?per_page=200&fields=${encodeURIComponent(FIELD_UPDATE_FIELDS)}`,
				{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
				apiDomain
			);
			if (Array.isArray(response.data) && response.data.length > 0) {
				const ids = response.data.map((record: any) => record?.id).filter(Boolean) as string[];
				if (ids.length > 0) return await fetchFieldUpdatesByIds(accessToken, ids, apiDomain);
				return response.data as any[];
			}
		} catch {
			// Some related-list endpoints don't support fields filtering; try without it.
			try {
				const response = await zohoApiCall(
					accessToken,
					`${baseEndpoint}?per_page=200`,
					{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
					apiDomain
				);
				if (Array.isArray(response.data) && response.data.length > 0) {
					const ids = response.data.map((record: any) => record?.id).filter(Boolean) as string[];
					if (ids.length > 0) return await fetchFieldUpdatesByIds(accessToken, ids, apiDomain);
					return response.data as any[];
				}
			} catch {
				// Ignore and keep trying candidates.
			}
		}
	}

	// 2) Attempt search queries using the discovered deal lookup field, then fallback candidates.
	const discoveredLookup = await discoverFieldUpdatesDealLookupField(accessToken, apiDomain).catch(() => null);
	const dealFieldCandidates = Array.from(
		new Set([
			discoveredLookup,
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
		].filter(Boolean))
	) as string[];

	for (const field of dealFieldCandidates) {
		const criteria = `(${field}:equals:${dealId})`;
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Field_Updates/search?criteria=${encodeURIComponent(criteria)}&per_page=200&fields=${encodeURIComponent(
					FIELD_UPDATE_FIELDS
				)}`,
				{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
				apiDomain
			);
			if (Array.isArray(response.data) && response.data.length > 0) {
				const ids = response.data.map((record: any) => record?.id).filter(Boolean) as string[];
				if (ids.length > 0) return await fetchFieldUpdatesByIds(accessToken, ids, apiDomain);
				return response.data as any[];
			}
		} catch {
			// Ignore and keep trying candidate field names.
		}
	}

	// 3) Fallback: list recent Field Updates and filter locally (works even when the lookup field name varies).
	const lookupField = discoveredLookup;
	const all = await fetchRecentFieldUpdates(accessToken, apiDomain, lookupField);
	const matching = all.filter((record) => recordReferencesDeal(record || {}, dealId, lookupField));
	if (matching.length === 0) return [];

	// If we fetched without a fields filter, hydrate minimal fields for the matched ids.
	if (!lookupField) {
		const ids = matching.map((record: any) => String(record?.id || '')).filter(Boolean);
		if (ids.length > 0) return await fetchFieldUpdatesByIds(accessToken, ids, apiDomain);
	}

	return matching;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		throw error(401, 'Invalid session');
	}

	const tradePartnerId = session.trade_partner.zoho_trade_partner_id;
	if (!tradePartnerId) {
		throw error(400, 'Trade partner is missing Zoho ID');
	}

	const dealId = params.dealId;
	if (!dealId) {
		throw error(400, 'Deal ID required');
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
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

	const apiDomain = tokens.api_domain || undefined;
	const allowed = await tradePartnerCanAccessDeal(accessToken, dealId, tradePartnerId, apiDomain);
	if (!allowed) {
		throw error(403, 'Access denied');
	}

	const records = await fetchFieldUpdatesForDeal(accessToken, dealId, apiDomain);
	const normalized = (records || [])
		.map((record) => normalizeFieldUpdate(record || {}))
		.filter((item) => item.id);

	normalized.sort((a, b) => {
		const aDate = new Date(a.createdAt || a.updatedAt || 0).getTime();
		const bDate = new Date(b.createdAt || b.updatedAt || 0).getTime();
		return bDate - aDate;
	});

	return json({ data: normalized });
};
