import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import {
	getProgressPhotosLinkCandidates,
	pickBestProgressPhotosFallback,
	resolveProgressPhotosLink
} from '$lib/server/progress-photos';
import { refreshAccessToken } from '$lib/server/zoho';

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain || undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain };
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const tradePartnerId = String(session.trade_partner.zoho_trade_partner_id || '').trim();
	if (!tradePartnerId) throw error(403, 'No linked trade partner');

	const dealId = String(params.dealId || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const { accessToken, apiDomain } = await getAccessToken();
	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const deal = deals.find((item: any) => String(item?.id || '').trim() === dealId);
	if (!deal) {
		throw error(403, 'Access denied to this project');
	}

	const directPhotosDeal = { Progress_Photos: deal?.Progress_Photos };
	const candidates = getProgressPhotosLinkCandidates(directPhotosDeal);
	const url =
		(await resolveProgressPhotosLink(directPhotosDeal)) || pickBestProgressPhotosFallback(candidates);
	if (url) {
		throw redirect(302, url);
	}

	throw redirect(302, `/trade/photos?dealId=${encodeURIComponent(dealId)}`);
};
