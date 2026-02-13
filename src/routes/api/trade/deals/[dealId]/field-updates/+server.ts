import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const ZOHO_TIMEOUT_MS = 15000;
const FIELD_UPDATE_FIELDS = ['Note', 'Update_Type', 'Created_Time', 'Modified_Time', 'Name'].join(',');

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
};

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
		body
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

	const response = await zohoApiCall(
		accessToken,
		`/settings/related_lists?module=${encodeURIComponent('Deals')}`,
		{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
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

	const response = await zohoApiCall(
		accessToken,
		`/settings/fields?module=${encodeURIComponent('Field_Updates')}`,
		{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
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

async function fetchFieldUpdatesForDeal(accessToken: string, dealId: string, apiDomain?: string) {
	// 1) Attempt related list fetch from the Deal record (best signal, no need to know lookup field).
	const discovered = await discoverDealRelatedListApiName(accessToken, apiDomain).catch(() => null);
	const relatedCandidates = Array.from(
		new Set([discovered, 'Field_Updates', 'Field_Updates1', 'Field_Updates2', 'Field_Updates3'].filter(Boolean))
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
			if (Array.isArray(response.data) && response.data.length > 0) return response.data as any[];
		} catch {
			// Some related-list endpoints don't support fields filtering; try without it.
			try {
				const response = await zohoApiCall(
					accessToken,
					`${baseEndpoint}?per_page=200`,
					{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
					apiDomain
				);
				if (Array.isArray(response.data) && response.data.length > 0) return response.data as any[];
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
			if (Array.isArray(response.data) && response.data.length > 0) return response.data as any[];
		} catch {
			// Ignore and keep trying candidate field names.
		}
	}

	return [];
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
