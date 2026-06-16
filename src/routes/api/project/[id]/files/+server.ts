import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { listAllClientDocuments } from '$lib/server/client-portal-files';
import { getOrCreateWorkDriveFileShare } from '$lib/server/workdrive-shares';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import type { RequestHandler } from './$types';

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho tokens not configured');

	const accessToken = valid.accessToken;
	const apiDomain = valid.apiDomain;
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
