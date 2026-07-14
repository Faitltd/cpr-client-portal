import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, supabase } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { RESIDENTIAL_CHECKLIST_KEY } from '$lib/data/residential-checklist';

// Home Building Checklist progress for the trade side (trade partners + ops).
// One shared row per deal — any authorized trade user sees and updates the
// same list. Authorization: the deal must belong to the partner's deals.

const authCache = new Map<string, { fetchedAt: number; dealIds: Set<string> }>();
const AUTH_CACHE_TTL_MS = 2 * 60 * 1000;

async function requireAuthorizedSession(sessionToken: string | undefined, dealId: string) {
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const partnerZohoId = session.trade_partner.zoho_trade_partner_id;
	if (!partnerZohoId) throw error(403, 'No linked trade partner');

	const cached = authCache.get(partnerZohoId);
	if (cached && Date.now() - cached.fetchedAt < AUTH_CACHE_TTL_MS) {
		if (!cached.dealIds.has(String(dealId))) throw error(403, 'Deal not authorized');
		return session;
	}

	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho not configured');

	const deals = await getTradePartnerDeals(valid.accessToken, partnerZohoId);
	const dealIds = new Set<string>();
	for (const deal of deals) {
		const id = String(deal?.id || '').trim();
		if (id) dealIds.add(id);
	}
	authCache.set(partnerZohoId, { fetchedAt: Date.now(), dealIds });

	if (!dealIds.has(String(dealId))) throw error(403, 'Deal not authorized');
	return session;
}

// GET /api/trade/checklist?deal_id=… — the deal's shared checked item ids.
export const GET: RequestHandler = async ({ cookies, url }) => {
	const dealId = (url.searchParams.get('deal_id') || '').trim();
	if (!dealId) return json({ error: 'deal_id is required' }, { status: 400 });

	await requireAuthorizedSession(cookies.get('trade_session'), dealId);

	const { data, error: dbError } = await supabase
		.from('trade_checklist_progress')
		.select('checked_item_ids')
		.eq('deal_id', dealId)
		.eq('checklist_key', RESIDENTIAL_CHECKLIST_KEY)
		.maybeSingle();

	if (dbError) {
		console.error('GET /api/trade/checklist error:', dbError.message);
		return json({ error: 'Failed to load checklist progress' }, { status: 500 });
	}
	return json({ checked_item_ids: data?.checked_item_ids ?? [] });
};

// PUT /api/trade/checklist — save the full set of checked ids for one deal.
export const PUT: RequestHandler = async ({ cookies, request }) => {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });

	const dealId = String(body.deal_id || '').trim();
	if (!dealId) return json({ error: 'deal_id is required' }, { status: 400 });

	const session = await requireAuthorizedSession(cookies.get('trade_session'), dealId);

	const checkedIds = Array.isArray(body.checked_item_ids)
		? [...new Set(body.checked_item_ids.map((v: unknown) => String(v)).filter(Boolean))]
		: [];

	const { error: dbError } = await supabase.from('trade_checklist_progress').upsert(
		{
			deal_id: dealId,
			checklist_key: RESIDENTIAL_CHECKLIST_KEY,
			checked_item_ids: checkedIds,
			updated_by: session.trade_partner?.email ?? null,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'deal_id,checklist_key' }
	);

	if (dbError) {
		console.error('PUT /api/trade/checklist error:', dbError.message);
		return json({ error: 'Failed to save checklist progress' }, { status: 500 });
	}
	return json({ ok: true, checked_item_ids: checkedIds });
};
