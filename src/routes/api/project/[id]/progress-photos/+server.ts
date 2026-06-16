import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import {
	getProgressPhotosLinkCandidates,
	pickBestProgressPhotosFallback,
	resolveProgressPhotosLink
} from '$lib/server/progress-photos';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';

const DEAL_LINK_CACHE_TTL_MS = 60 * 1000;

const resolvedDealLinkCache = new Map<string, { fetchedAt: number; url: string }>();

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw error(500, 'Zoho tokens not configured');
	}

	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
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

	const candidates = getProgressPhotosLinkCandidates(deal);
	const url = (await resolveProgressPhotosLink(deal)) || pickBestProgressPhotosFallback(candidates);
	if (!url) {
		throw error(404, 'No valid progress photos link is configured for this project.');
	}

	try {
		const parsed = new URL(url);
		console.info('Progress photos link selected', {
			dealId,
			candidateCount: candidates.length,
			host: parsed.host,
			path: parsed.pathname
		});
	} catch {
		console.info('Progress photos link selected', {
			dealId,
			candidateCount: candidates.length
		});
	}

	resolvedDealLinkCache.set(dealId, { fetchedAt: Date.now(), url });
	throw redirect(302, url);
};
