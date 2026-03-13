import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import { parseZohoProjectIds, updateZohoTaskStatus } from '$lib/server/projects';

const VALID_STATUSES = new Set(['open', 'in_progress', 'completed']);

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

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
			{ error: 'Invalid status. Must be one of: open, in_progress, completed' },
			{ status: 400 }
		);
	}

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

	// Verify authorization
	let authorizedProjectIds: Set<string>;
	try {
		const dealList = await getTradePartnerDeals(accessToken);
		authorizedProjectIds = new Set<string>();
		for (const deal of dealList) {
			const ids = parseZohoProjectIds(deal?.Zoho_Projects_ID);
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
