import { json } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const clientEmail = context.session.client.email;
		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);

		if (dealIds.length === 0) {
			return json({ data: [] });
		}

		const { data, error } = await supabase
			.from('email_preferences')
			.select('*')
			.eq('client_email', clientEmail)
			.in('deal_id', dealIds);

		if (error) throw new Error(error.message);
		return json({ data: data || [] });
	} catch (err) {
		console.error('GET /api/client/email-preferences error:', err);
		const error = err instanceof Error ? err.message : 'Failed to fetch email preferences';
		return json({ error }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ cookies, request }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const clientEmail = context.session.client.email;
		const body = await request.json().catch(() => null);
		if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });

		const { deal_id, frequency } = body;
		if (!deal_id) return json({ error: 'deal_id is required' }, { status: 400 });
		if (!frequency || !['daily', 'weekly', 'none'].includes(frequency)) {
			return json({ error: 'frequency must be daily, weekly, or none' }, { status: 400 });
		}

		// Verify the deal belongs to this client
		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);
		if (!dealIds.includes(deal_id)) {
			return json({ error: 'Deal not found' }, { status: 404 });
		}

		const { data: existing } = await supabase
			.from('email_preferences')
			.select('id')
			.eq('deal_id', deal_id)
			.eq('client_email', clientEmail)
			.maybeSingle();

		let result;
		if (existing) {
			result = await supabase
				.from('email_preferences')
				.update({ frequency, updated_at: new Date().toISOString() })
				.eq('deal_id', deal_id)
				.eq('client_email', clientEmail)
				.select()
				.single();
		} else {
			result = await supabase
				.from('email_preferences')
				.insert({
					deal_id,
					client_email: clientEmail,
					frequency,
					enabled: frequency !== 'none'
				})
				.select()
				.single();
		}

		if (result.error) throw new Error(result.error.message);
		return json({ data: result.data });
	} catch (err) {
		console.error('PUT /api/client/email-preferences error:', err);
		const error = err instanceof Error ? err.message : 'Failed to update email preferences';
		return json({ error }, { status: 500 });
	}
};
