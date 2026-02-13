import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

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

function getId(value: any): string | null {
	if (!value || typeof value !== 'object') return null;
	return (value.id || value.ID || value.Id || value.record_id || value.recordId || null) as string | null;
}

function looksLikeUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	return /^https?:\/\//i.test(trimmed);
}

function extractUrlsFromValue(
	value: any,
	urls: Set<string>,
	depth = 0
): void {
	if (value === null || value === undefined) return;
	if (depth > 5) return;

	if (looksLikeUrl(value)) {
		urls.add(value.trim());
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) extractUrlsFromValue(item, urls, depth + 1);
		return;
	}

	if (typeof value === 'object') {
		// Common “file/link” object shapes
		for (const key of ['link_url', 'link', 'download_url', 'url', 'href', 'File_URL', 'File_Url', 'file_url']) {
			const maybe = (value as any)?.[key];
			if (looksLikeUrl(maybe)) urls.add(String(maybe).trim());
		}

		for (const item of Object.values(value)) {
			extractUrlsFromValue(item, urls, depth + 1);
		}
	}
}

function extractUsefulUrls(record: Record<string, any>): string[] {
	const urls = new Set<string>();
	const likelyAttachmentKey = (key: string) =>
		/(workdrive|drive|file|files|image|images|photo|photos|video|videos|media|attachment|attachments|url|link)/i.test(
			key
		);

	for (const [key, value] of Object.entries(record || {})) {
		if (!likelyAttachmentKey(key)) continue;
		extractUrlsFromValue(value, urls);
	}

	// Fallback: sometimes URLs are nested in fields that don’t include “url/link”
	if (urls.size === 0) {
		extractUrlsFromValue(record, urls);
	}

	return Array.from(urls);
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
		const id = getId(value);
		if (id) return id;
	}
	return null;
}

function recordReferencesDeal(record: Record<string, any>, dealId: string): boolean {
	const target = String(dealId);
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
		if (depth > 5) return false;
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

function buildSummaryFields(record: Record<string, any>): Array<{ label: string; value: string }> {
	const ignore = new Set([
		'id',
		'Created_Time',
		'Modified_Time',
		'Created_By',
		'Modified_By',
		'Owner',
		'Tag',
		'Deal_Name',
		'Deal',
		'Deals',
		'Portal_Deal',
		'Portal_Deals'
	]);
	const bodyKeys = new Set([
		'Description',
		'Details',
		'Notes',
		'Note',
		'Comments',
		'Summary',
		'Message',
		'Update_Notes',
		'Update_Details'
	]);

	const rows: Array<{ label: string; value: string }> = [];
	for (const [key, value] of Object.entries(record || {})) {
		if (!key) continue;
		if (ignore.has(key)) continue;
		if (bodyKeys.has(key)) continue;
		if (/(workdrive|drive|file|files|image|images|photo|photos|video|videos|media|attachment|attachments|url|link)/i.test(key)) {
			continue;
		}

		const text = coerceText(value);
		if (!text) continue;
		if (text.length > 120) continue;
		rows.push({ label: key.replace(/_/g, ' '), value: text });
		if (rows.length >= 12) break;
	}

	return rows;
}

type FieldUpdateTimelineItem = {
	id: string;
	createdAt: string | null;
	updatedAt: string | null;
	type: string | null;
	title: string | null;
	body: string | null;
	links: string[];
	fields: Array<{ label: string; value: string }>;
};

function normalizeFieldUpdate(record: Record<string, any>): FieldUpdateTimelineItem {
	const createdAt = pickFirstText(record, ['Created_Time', 'created_time', 'CreatedTime', 'createdAt', 'created_at']);
	const updatedAt = pickFirstText(record, ['Modified_Time', 'modified_time', 'ModifiedTime', 'updatedAt', 'updated_at']);
	const type = inferType(record);
	const title = pickFirstText(record, ['Name', 'Subject', 'Title', 'Update_Title', 'UpdateTitle']);
	const body =
		pickFirstText(record, [
			'Update_Notes',
			'Update_Details',
			'Description',
			'Details',
			'Notes',
			'Note',
			'Comments',
			'Summary',
			'Message'
		]) || null;

	return {
		id: String(record?.id || ''),
		createdAt: createdAt || null,
		updatedAt: updatedAt || null,
		type: type || null,
		title: title || null,
		body,
		links: extractUsefulUrls(record),
		fields: buildSummaryFields(record)
	};
}

async function fetchAllFieldUpdates(accessToken: string, apiDomain?: string) {
	const perPage = 200;
	let page = 1;
	let more = true;
	const results: any[] = [];

	while (more && page <= 20) {
		const response = await zohoApiCall(
			accessToken,
			`/Field_Updates?per_page=${perPage}&page=${page}`,
			{},
			apiDomain
		);
		results.push(...(response.data || []));
		more = Boolean(response.info?.more_records);
		page += 1;
	}

	return results;
}

async function fetchFieldUpdatesForDeal(accessToken: string, dealId: string, apiDomain?: string) {
	// 1) Attempt related list fetch from the Deal record.
	const relatedCandidates = ['Field_Updates', 'Field_Updates1', 'Field_Updates2', 'Field_Updates3'];
	for (const related of relatedCandidates) {
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Deals/${dealId}/${related}?per_page=200`,
				{},
				apiDomain
			);
			if (Array.isArray(response.data) && response.data.length > 0) {
				return response.data as any[];
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Keep falling back; orgs vary on related list API names.
			if (/related list/i.test(message) || /invalid/i.test(message)) continue;
		}
	}

	// 2) Attempt search queries against likely lookup field API names.
	const dealFieldCandidates = [
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
	const operators = ['equals', 'in'];
	for (const field of dealFieldCandidates) {
		for (const operator of operators) {
			const criteria = `(${field}:${operator}:${dealId})`;
			try {
				const response = await zohoApiCall(
					accessToken,
					`/Field_Updates/search?criteria=${encodeURIComponent(criteria)}&per_page=200`,
					{},
					apiDomain
				);
				if (Array.isArray(response.data) && response.data.length > 0) {
					return response.data as any[];
				}
			} catch {
				// Ignore and keep trying candidate field names/operators.
			}
		}
	}

	// 3) Fallback: list recent records and filter by embedded Deal lookup id.
	const all = await fetchAllFieldUpdates(accessToken, apiDomain);
	return all.filter((record) => recordReferencesDeal(record || {}, dealId));
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
	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const allowed = deals.some((deal: any) => String(deal?.id) === String(dealId));
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
