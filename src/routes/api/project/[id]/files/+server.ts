import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { refreshAccessToken } from '$lib/server/zoho';
import { listAllClientDocuments } from '$lib/server/client-portal-files';
import { getOrCreateWorkDriveFileShare } from '$lib/server/workdrive-shares';
import type { RequestHandler } from './$types';

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho tokens not configured');

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
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session?.client) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '').trim() === dealId)) {
		throw error(403, 'Access denied to this project');
	}

	const { accessToken, apiDomain } = await getAccessToken();

	const files = await listAllClientDocuments(accessToken, dealId, apiDomain);
	if (files.length === 0) {
		return json({ files: [], message: 'No documents found for this project yet.' });
	}

	// Prefer an external WorkDrive share (opens the doc in Zoho's viewer with
	// no login). If share minting fails, fall back to our authenticated
	// download proxy so the link always opens the document.
	const enriched = await Promise.all(
		files.map(async (f) => {
			const share = await getOrCreateWorkDriveFileShare({
				accessToken,
				apiDomain,
				fileId: f.id,
				fileName: f.name
			}).catch(() => null);
			return {
				...f,
				url:
					share ??
					`/api/project/${encodeURIComponent(dealId)}/files/${encodeURIComponent(f.id)}?name=${encodeURIComponent(f.name)}`
			};
		})
	);

	return json({ files: enriched });
};
