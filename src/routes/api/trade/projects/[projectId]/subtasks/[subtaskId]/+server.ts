import { json, error } from '@sveltejs/kit';
import { getTradeSession, setSubtaskDone } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { parseZohoProjectIds } from '$lib/server/projects';
import type { RequestHandler } from './$types';

// PUT /api/trade/projects/:projectId/subtasks/:subtaskId  body: { isDone }
export const PUT: RequestHandler = async ({ cookies, params, request }) => {
	const token = cookies.get('trade_session');
	if (!token) throw error(401, 'Not authenticated');
	const session = await getTradeSession(token);
	if (!session) throw error(401, 'Invalid session');
	if (!session.trade_partner.zoho_trade_partner_id) throw error(403, 'No linked trade partner');

	const { projectId, subtaskId } = params;
	if (!projectId || !subtaskId) throw error(400, 'Missing params');

	const body = await request.json().catch(() => ({}));
	const isDone = body?.isDone === true || body?.is_done === true;

	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho not configured');

	let authorized = new Set<string>();
	try {
		const deals = await getTradePartnerDeals(
			valid.accessToken,
			session.trade_partner.zoho_trade_partner_id
		);
		for (const d of deals) {
			for (const id of parseZohoProjectIds(d?.Project_ID ?? d?.Zoho_Projects_ID)) authorized.add(id);
		}
	} catch (err) {
		console.error('Subtask auth check failed:', err);
		throw error(500, 'Failed to verify authorization');
	}
	if (!authorized.has(projectId)) throw error(403, 'Not authorized for this project');

	const doneBy =
		session.trade_partner.name || session.trade_partner.email || 'trade partner';
	const updated = await setSubtaskDone(subtaskId, isDone, isDone ? doneBy : null);
	if (!updated) return json({ error: 'Subtask not found' }, { status: 404 });
	return json({ data: updated });
};
