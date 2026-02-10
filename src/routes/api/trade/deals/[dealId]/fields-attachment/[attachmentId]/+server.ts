import { error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import { ZOHO_API_BASE } from '$env/static/private';
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

function safeFileName(value: string) {
	return value.replace(/[/\\]/g, '_').replace(/"/g, "'");
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

	const dealId = params.dealId;
	const attachmentId = params.attachmentId;
	if (!dealId || !attachmentId) {
		throw error(400, 'Deal ID and attachment ID are required');
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

	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, tokens.api_domain);
	const allowed = deals.some((deal: any) => String(deal?.id) === String(dealId));
	if (!allowed) {
		throw error(403, 'Access denied');
	}

	const base = tokens.api_domain
		? `${tokens.api_domain.replace(/\/$/, '')}/crm/v8`
		: ZOHO_API_BASE;
	const downloadUrl = `${base}/Deals/${dealId}/actions/download_fields_attachment?fields_attachment_id=${encodeURIComponent(attachmentId)}`;

	const response = await fetch(downloadUrl, {
		method: 'GET',
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
	const disposition = response.headers.get('content-disposition');
	if (disposition) {
		headers.set('Content-Disposition', disposition);
	} else {
		const fileName = safeFileName(url.searchParams.get('fileName') || 'design-file');
		headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
	}

	return new Response(response.body, {
		status: response.status,
		headers
	});
};
