import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import {
	getDealProjectIdsForLinking,
	getAllProjectTasks,
	matchDealsToProjectsByName
} from '$lib/server/projects';
import { getDealsForClient } from '$lib/server/projects';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('client-project-tasks');

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho tokens not configured');
	const accessToken = valid.accessToken;
	const apiDomain = valid.apiDomain;
	return { accessToken, apiDomain };
}

/**
 * GET /api/project/:id/tasks
 *
 * Returns the Zoho Projects task list for the deal's linked project. Client
 * portal endpoint — verifies the deal belongs to the authenticated homeowner
 * before returning anything. Resolves the Zoho Project ID by:
 *   1. CRM custom fields on the Deal (Project_ID / Zoho_Projects_ID)
 *   2. Name match between Deal name and Zoho Projects catalog (fallback)
 * If neither resolves, returns `{ tasks: [], projectId: null }`.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('portal_session');
	const dealId = params.id;
	if (!sessionToken) throw error(401, 'Not authenticated');
	if (!dealId) throw error(400, 'Deal ID required');

	const session = await getSession(sessionToken);
	if (!session?.client) throw error(401, 'Invalid session');

	const accessibleDeals = await getDealsForClient(
		session.client.zoho_contact_id,
		session.client.email
	);
	const ownDeal = accessibleDeals.find((d: any) => String(d?.id || '') === dealId);
	if (!ownDeal) throw error(403, 'Access denied to this project');

	const { accessToken, apiDomain } = await getAccessToken();

	// Pull the Deal record with project-linking fields. The list above may have
	// come from a slim cache; re-fetch to make sure Project_ID is included.
	let dealRecord: any = ownDeal;
	try {
		const dealFields = 'Deal_Name,Project_ID,Zoho_Projects_ID';
		const dealResp = await zohoApiCall(
			accessToken,
			`/Deals/${dealId}?fields=${encodeURIComponent(dealFields)}`,
			{},
			apiDomain
		);
		const fetched = dealResp?.data?.[0];
		if (fetched) {
			dealRecord = { ...ownDeal, ...fetched };
		}
	} catch (err) {
		log.warn('Deal re-fetch failed; using cached record', {
			dealId,
			err: err instanceof Error ? err.message : String(err)
		});
	}

	let projectId =
		(getDealProjectIdsForLinking(dealRecord)[0] || '').toString().trim() || null;

	if (!projectId) {
		try {
			const matches = await matchDealsToProjectsByName([dealRecord]);
			const matched = matches.get(String(dealId));
			if (matched) projectId = String(matched);
		} catch (err) {
			log.warn('Project name match failed', {
				dealId,
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}

	if (!projectId) {
		return json({ tasks: [], projectId: null, source: 'no_project' });
	}

	try {
		const tasks = await getAllProjectTasks(projectId, 100);
		return json({ tasks: Array.isArray(tasks) ? tasks : [], projectId, source: 'zprojects' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('getAllProjectTasks failed', { dealId, projectId, err: message });
		return json({ tasks: [], projectId, source: 'zprojects', error: message });
	}
};
