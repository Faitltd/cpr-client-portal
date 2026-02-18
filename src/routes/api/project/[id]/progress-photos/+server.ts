import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { resolveProgressPhotosLink } from '$lib/server/progress-photos';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const DEAL_LINK_CACHE_TTL_MS = 10 * 60 * 1000;

const resolvedDealLinkCache = new Map<string, { fetchedAt: number; url: string }>();

async function getAccessToken() {
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
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope
		});
		return { accessToken, apiDomain: refreshed.api_domain || undefined };
	}

	return { accessToken, apiDomain: tokens.api_domain || undefined };
}

async function canClientAccessDeal(session: Awaited<ReturnType<typeof getSession>>, dealId: string) {
	if (!session?.client) return false;
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const cached = resolvedDealLinkCache.get(dealId);
	if (cached && Date.now() - cached.fetchedAt < DEAL_LINK_CACHE_TTL_MS) {
		throw redirect(302, cached.url);
	}

	if (!(await canClientAccessDeal(session, dealId))) {
		throw error(403, 'Access denied to this project');
	}

	const { accessToken, apiDomain } = await getAccessToken();
	const dealResponse = await zohoApiCall(accessToken, `/Deals/${dealId}`, {}, apiDomain);
	const deal = dealResponse.data?.[0];
	if (!deal) throw error(404, 'Deal not found');

	const url = await resolveProgressPhotosLink(deal);
	if (!url) {
		throw error(404, 'No valid progress photos link is configured for this project.');
	}

	resolvedDealLinkCache.set(dealId, { fetchedAt: Date.now(), url });
	throw redirect(302, url);
};
