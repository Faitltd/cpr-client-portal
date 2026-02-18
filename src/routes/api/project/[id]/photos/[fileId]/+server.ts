import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getWorkDriveDownloadCandidates } from '$lib/server/workdrive';
import { refreshAccessToken } from '$lib/server/zoho';

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

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
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain };
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
	const fileId = String(params.fileId || '').trim();
	if (!dealId || !fileId) throw error(400, 'Deal ID and file ID are required');

	if (!(await canClientAccessDeal(session, dealId))) {
		throw error(403, 'Access denied');
	}

	const { accessToken, apiDomain } = await getAccessToken();
	const candidates = getWorkDriveDownloadCandidates(apiDomain);
	let lastStatus = 500;
	let lastMessage = '';

	for (const base of candidates) {
		const downloadUrl = `${base.replace(/\/$/, '')}/${encodeURIComponent(fileId)}`;
		const response = await fetch(downloadUrl, {
			method: 'GET',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`
			}
		});

		if (!response.ok) {
			lastStatus = response.status;
			lastMessage = await response.text().catch(() => '');
			continue;
		}

		const headers = new Headers();
		const contentType = response.headers.get('content-type') || 'application/octet-stream';
		headers.set('Content-Type', contentType);
		const disposition = response.headers.get('content-disposition');
		if (disposition) headers.set('Content-Disposition', disposition);

		return new Response(response.body, {
			status: response.status,
			headers
		});
	}

	throw error(lastStatus, lastMessage || 'Failed to download WorkDrive file');
};
