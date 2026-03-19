import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import { parseZohoProjectIds, updateZohoTaskStatus } from '$lib/server/projects';

const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

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
	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho not configured');

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	// Verify project authorization — once for the whole batch
	let authorizedProjectIds: Set<string>;
	try {
		const dealList = await getTradePartnerDeals(accessToken);
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
