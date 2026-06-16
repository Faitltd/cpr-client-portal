import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { parseZohoProjectIds, updateZohoTaskStatus } from '$lib/server/projects';

const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

// PUT /api/trade/projects/:projectId/tasks/batch-status
// Body: { updates: [{ taskId, status }] }
// Auth check runs once; all Zoho calls run in parallel.
export const PUT: RequestHandler = async ({ cookies, params, request }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');
	if (!session.trade_partner.zoho_trade_partner_id) throw error(403, 'No linked trade partner');

	const { projectId } = params;
	if (!projectId) throw error(400, 'Project ID required');

	const body = await request.json().catch(() => ({}));
	const updates: Array<{ taskId: string; status: string }> = Array.isArray(body?.updates)
		? body.updates
		: [];

	if (updates.length === 0) {
		return json({ results: [] });
	}

	// Validate all statuses up front
	for (const u of updates) {
		const s = String(u?.status || '').trim().toLowerCase().replace(/\s+/g, '_');
		if (!s || !VALID_STATUSES.has(s)) {
			return json({ error: `Invalid status "${u?.status}" for task ${u?.taskId}` }, { status: 400 });
		}
		u.status = s;
	}

	// Auth + token refresh — once for the whole batch
	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho not configured');
	const accessToken = valid.accessToken;

	// Verify project authorization — once for the whole batch
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

	// Fire all Zoho task updates in parallel
	const settled = await Promise.allSettled(
		updates.map(({ taskId, status }) =>
			updateZohoTaskStatus(projectId, taskId, status)
		)
	);

	const results = updates.map(({ taskId }, i) => ({
		taskId,
		ok: settled[i].status === 'fulfilled',
		error: settled[i].status === 'rejected'
			? (settled[i] as PromiseRejectedResult).reason?.message ?? 'Failed'
			: undefined
	}));

	return json({ results });
};
