import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, supabase } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { getDealProjectIdsForLinking } from '$lib/server/projects';

// QC checklist data lives in Supabase (qc_trades / qc_items / qc_checklist_status),
// keyed by Zoho Projects project id. Trade partners only — authorization mirrors
// /api/trade/projects/[projectId]: the projectId must be linked to one of the
// partner's deals.

const authCache = new Map<string, { fetchedAt: number; projectIds: Set<string> }>();
const AUTH_CACHE_TTL_MS = 2 * 60 * 1000;

async function requireAuthorizedSession(sessionToken: string | undefined, projectId: string) {
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const partnerZohoId = session.trade_partner.zoho_trade_partner_id;
	if (!partnerZohoId) throw error(403, 'No linked trade partner');

	const cached = authCache.get(partnerZohoId);
	if (cached && Date.now() - cached.fetchedAt < AUTH_CACHE_TTL_MS) {
		if (!cached.projectIds.has(String(projectId))) throw error(403, 'Project not authorized');
		return session;
	}

	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho not configured');

	const deals = await getTradePartnerDeals(valid.accessToken, partnerZohoId);
	const projectIds = new Set<string>();
	for (const deal of deals) {
		for (const id of getDealProjectIdsForLinking(deal)) projectIds.add(String(id));
	}
	authCache.set(partnerZohoId, { fetchedAt: Date.now(), projectIds });

	if (!projectIds.has(String(projectId))) throw error(403, 'Project not authorized');
	return session;
}

// GET /api/trade/checklists/:projectId
// Returns all trades with their checklist items and this project's completion state.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const projectId = params.projectId;
	if (!projectId) throw error(400, 'Project ID required');

	await requireAuthorizedSession(cookies.get('trade_session'), projectId);

	const [tradesRes, itemsRes, statusRes] = await Promise.all([
		supabase.from('qc_trades').select('id, name, sort').order('sort'),
		supabase.from('qc_items').select('id, trade_id, seq, item').order('seq'),
		supabase
			.from('qc_checklist_status')
			.select('item_id, completed, completed_by, completed_at')
			.eq('zoho_project_id', projectId)
	]);

	if (tradesRes.error || itemsRes.error || statusRes.error) {
		console.error(
			'[trade/checklists] load failed:',
			tradesRes.error || itemsRes.error || statusRes.error
		);
		throw error(500, 'Failed to load checklists');
	}

	const statusByItem = new Map<number, any>(
		(statusRes.data ?? []).map((s: any) => [s.item_id, s] as [number, any])
	);

	const checklists = (tradesRes.data ?? []).map((t: any) => {
		const items = (itemsRes.data ?? [])
			.filter((i: any) => i.trade_id === t.id)
			.map((i: any) => {
				const s = statusByItem.get(i.id);
				return {
					id: i.id,
					seq: i.seq,
					item: i.item,
					completed: s?.completed ?? false,
					completedBy: s?.completed_by ?? null,
					completedAt: s?.completed_at ?? null
				};
			});
		return {
			id: t.id,
			name: t.name,
			items,
			done: items.filter((i: any) => i.completed).length,
			total: items.length
		};
	});

	return json({ projectId, checklists });
};

// POST /api/trade/checklists/:projectId
// Body: { itemId: number, completed: boolean } — toggles one checklist item.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const projectId = params.projectId;
	if (!projectId) throw error(400, 'Project ID required');

	const session = await requireAuthorizedSession(cookies.get('trade_session'), projectId);

	let body: any;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const itemId = Number(body?.itemId);
	const completed = body?.completed === true;
	if (!Number.isInteger(itemId) || itemId <= 0) throw error(400, 'Missing itemId');

	const who = session.trade_partner.name || session.trade_partner.email || 'unknown';

	const { error: upErr } = await supabase.from('qc_checklist_status').upsert(
		{
			zoho_project_id: String(projectId),
			item_id: itemId,
			completed,
			completed_by: completed ? who : null,
			completed_at: completed ? new Date().toISOString() : null
		},
		{ onConflict: 'zoho_project_id,item_id' }
	);

	if (upErr) {
		console.error('[trade/checklists] toggle failed:', upErr);
		throw error(500, 'Save failed');
	}

	return json({ ok: true, itemId, completed });
};
