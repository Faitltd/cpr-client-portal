import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { updateProcurementItem } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const updates: Record<string, unknown> = {};
	if ('status' in body) updates.status = body.status;
	if ('vendor' in body) updates.vendor = body.vendor;
	if ('cost' in body) updates.cost = body.cost;
	if ('lead_time_days' in body) updates.lead_time_days = body.lead_time_days;
	if ('expected_date' in body) updates.expected_date = body.expected_date;
	if ('actual_date' in body) updates.actual_date = body.actual_date;
	if ('notes' in body) updates.notes = body.notes;

	try {
		const item = await updateProcurementItem(params.id, updates);
		return json({ data: item });
	} catch (err) {
		console.error('[PATCH /api/admin/procurement/:id]', err);
		const error = err instanceof Error ? err.message : 'Failed to update procurement item';
		return json({ error }, { status: 500 });
	}
};
