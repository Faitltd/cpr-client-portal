import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = params.dealId;
	if (!dealId) return json({ error: 'Missing dealId' }, { status: 400 });

	try {
		const { data, error } = await supabase
			.from('email_preferences')
			.select('*')
			.eq('deal_id', dealId);

		if (error) throw new Error(error.message);
		return json({ data: data || [] });
	} catch (err) {
		console.error(`GET /api/admin/email-preferences/${dealId} error:`, err);
		const error = err instanceof Error ? err.message : 'Failed to fetch preferences';
		return json({ error }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ cookies, params, request }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = params.dealId;
	if (!dealId) return json({ error: 'Missing dealId' }, { status: 400 });

	try {
		const body = await request.json().catch(() => null);
		if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });

		const { client_email, frequency, enabled } = body;
		if (!client_email) return json({ error: 'client_email is required' }, { status: 400 });

		const updates: Record<string, any> = { updated_at: new Date().toISOString() };
		if (typeof frequency === 'string' && ['daily', 'weekly', 'none'].includes(frequency)) {
			updates.frequency = frequency;
		}
		if (typeof enabled === 'boolean') {
			updates.enabled = enabled;
		}

		// Upsert: create if not exists, update if exists
		const { data: existing } = await supabase
			.from('email_preferences')
			.select('id')
			.eq('deal_id', dealId)
			.eq('client_email', client_email)
			.maybeSingle();

		let result;
		if (existing) {
			result = await supabase
				.from('email_preferences')
				.update(updates)
				.eq('deal_id', dealId)
				.eq('client_email', client_email)
				.select()
				.single();
		} else {
			result = await supabase
				.from('email_preferences')
				.insert({
					deal_id: dealId,
					client_email,
					frequency: updates.frequency || 'weekly',
					enabled: updates.enabled ?? true,
					...updates
				})
				.select()
				.single();
		}

		if (result.error) throw new Error(result.error.message);
		return json({ data: result.data });
	} catch (err) {
		console.error(`PUT /api/admin/email-preferences/${dealId} error:`, err);
		const error = err instanceof Error ? err.message : 'Failed to update preferences';
		return json({ error }, { status: 500 });
	}
};
