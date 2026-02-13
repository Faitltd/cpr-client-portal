import { error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_API_BASE = env.ZOHO_API_BASE || '';
const ZOHO_TIMEOUT_MS = 15000;

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

function safeFileName(value: string) {
	return value.replace(/[/\\]/g, '_').replace(/"/g, "'");
}

function getId(value: any): string | null {
	if (!value || typeof value !== 'object') return null;
	return (value.id || value.ID || value.Id || null) as string | null;
}

function extractDealIdFromFieldUpdate(record: Record<string, any>): string | null {
	if (!record || typeof record !== 'object') return null;
	for (const [key, value] of Object.entries(record)) {
		if (!/deal/i.test(key)) continue;
		if (!value) continue;
		if (typeof value === 'string' || typeof value === 'number') return String(value);
		if (Array.isArray(value)) {
			for (const item of value) {
				const id = getId(item);
				if (id) return String(id);
			}
			continue;
		}
		if (typeof value === 'object') {
			const id = getId(value);
			if (id) return String(id);
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

export const GET: RequestHandler = async ({ params, cookies, url }) => {
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

	const updateId = params.updateId;
	const attachmentId = params.attachmentId;
	if (!updateId || !attachmentId) {
		throw error(400, 'Field update ID and attachment ID are required');
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

	// Authorize: the update must be related to a deal the trade partner can access.
	const updateRecordResponse = await zohoApiCall(
		accessToken,
		`/Field_Updates/${encodeURIComponent(updateId)}`,
		{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
		apiDomain
	);
	const updateRecord = updateRecordResponse.data?.[0];
	if (!updateRecord) {
		throw error(404, 'Field update not found');
	}

	const dealId = extractDealIdFromFieldUpdate(updateRecord as Record<string, any>);
	if (!dealId) {
		throw error(403, 'Unable to verify access');
	}

	const allowed = await tradePartnerCanAccessDeal(accessToken, dealId, tradePartnerId, apiDomain);
	if (!allowed) {
		throw error(403, 'Access denied');
	}

	const base = apiDomain ? `${apiDomain.replace(/\/$/, '')}/crm/v8` : ZOHO_API_BASE;
	const downloadUrl = `${base}/Field_Updates/${encodeURIComponent(
		updateId
	)}/actions/download_fields_attachment?fields_attachment_id=${encodeURIComponent(attachmentId)}`;

	const response = await fetch(downloadUrl, {
		method: 'GET',
		signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS),
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`
		}
	});

	if (!response.ok) {
		const message = await response.text();
		throw error(response.status, message || 'Failed to download file');
	}

	const headers = new Headers();
	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	headers.set('Content-Type', contentType);
	const fileName = safeFileName(url.searchParams.get('fileName') || 'photo');
	const download = url.searchParams.get('download') === '1';
	headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);

	return new Response(response.body, {
		status: response.status,
		headers
	});
};
