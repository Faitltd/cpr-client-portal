import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { parseZohoProjectIds, updateZohoTaskStatus } from '$lib/server/projects';

const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

export const PUT: RequestHandler = async ({ cookies, params, request }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');
	if (!session.trade_partner.zoho_trade_partner_id) throw error(403, 'No linked trade partner');

	const { projectId, taskId } = params;
	if (!projectId) throw error(400, 'Project ID required');
	if (!taskId) throw error(400, 'Task ID required');

	const body = await request.json().catch(() => ({}));
	const status = String(body?.status || '').trim().toLowerCase().replace(/\s+/g, '_');

	if (!status) {
		return json({ error: 'Missing required field: status' }, { status: 400 });
	}
	if (!VALID_STATUSES.has(status)) {
		return json(
			{ error: 'Invalid status. Must be one of: not_started, in_progress, completed' },
			{ status: 400 }
		);
	}

	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho not configured');
	const accessToken = valid.accessToken;

	// Verify authorization
	let authorizedProjectIds: Set<string>;
	try {
		const dealList = await getTradePartnerDeals(
			accessToken,
			session.trade_partner.zoho_trade_partner_id
		);
		authorizedProjectIds = new Set<string>();
		for (const deal of dealList) {
			const ids = parseZohoProjectIds(deal?.Project_ID ?? deal?.Zoho_Projects_ID);
			for (const id of ids) authorizedProjectIds.add(id);
		}
	} catch (err) {
		console.error('Failed to verify trade partner project authorization:', err);
		throw error(500, 'Failed to verify authorization');
	}

	if (!authorizedProjectIds.has(projectId)) {
		throw error(403, 'Not authorized for this project');
	}

	try {
		const result = await updateZohoTaskStatus(projectId, taskId, status);
		return json({ data: result });
	} catch (err) {
		console.error('Failed to update task status:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Failed to update task status' },
			{ status: 500 }
		);
	}
};
