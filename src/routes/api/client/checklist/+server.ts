import { json } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { supabase } from '$lib/server/db';
import { RESIDENTIAL_CHECKLIST_KEY } from '$lib/data/residential-checklist';
import type { RequestHandler } from './$types';

// Returns the client's ticked-off checklist items for one deal.
export const GET: RequestHandler = async ({ cookies, url }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const dealId = (url.searchParams.get('deal_id') || '').trim();
		if (!dealId) return json({ error: 'deal_id is required' }, { status: 400 });

		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);
		if (!dealIds.includes(dealId)) return json({ error: 'Deal not found' }, { status: 404 });

		const clientEmail = context.session.client.email;
		const { data, error } = await supabase
			.from('client_checklist_progress')
			.select('checked_item_ids')
			.eq('client_email', clientEmail)
			.eq('deal_id', dealId)
			.eq('checklist_key', RESIDENTIAL_CHECKLIST_KEY)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return json({ checked_item_ids: data?.checked_item_ids ?? [] });
	} catch (err) {
		console.error('GET /api/client/checklist error:', err);
		const error = err instanceof Error ? err.message : 'Failed to load checklist progress';
		return json({ error }, { status: 500 });
	}
};

// Saves the full set of ticked item ids for one deal (upsert).
export const PUT: RequestHandler = async ({ cookies, request }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const body = await request.json().catch(() => null);
		if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });

		const dealId = String(body.deal_id || '').trim();
		if (!dealId) return json({ error: 'deal_id is required' }, { status: 400 });

		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);
		if (!dealIds.includes(dealId)) return json({ error: 'Deal not found' }, { status: 404 });

		const checkedIds = Array.isArray(body.checked_item_ids)
			? [...new Set(body.checked_item_ids.map((v: unknown) => String(v)).filter(Boolean))]
			: [];

		const clientEmail = context.session.client.email;
		const { error } = await supabase.from('client_checklist_progress').upsert(
			{
				client_email: clientEmail,
				deal_id: dealId,
				checklist_key: RESIDENTIAL_CHECKLIST_KEY,
				checked_item_ids: checkedIds,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'client_email,deal_id,checklist_key' }
		);

		if (error) throw new Error(error.message);
		return json({ ok: true, checked_item_ids: checkedIds });
	} catch (err) {
		console.error('PUT /api/client/checklist error:', err);
		const error = err instanceof Error ? err.message : 'Failed to save checklist progress';
		return json({ error }, { status: 500 });
	}
};
