import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession } from '$lib/server/db';
import {
	getProgressPhotosLinkCandidates,
	pickBestProgressPhotosFallback,
	resolveProgressPhotosLink
} from '$lib/server/progress-photos';
import { ensureValidZohoToken } from '$lib/server/zoho-token';

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw error(500, 'Zoho tokens not configured');
	}
	const accessToken = valid.accessToken;
	const apiDomain = valid.apiDomain;

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
	const dealList = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const deal = dealList.find((item: any) => String(item?.id || '').trim() === dealId);
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
