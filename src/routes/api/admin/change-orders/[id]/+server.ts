import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { updateChangeOrder } from '$lib/server/db';
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
	if ('title' in body) updates.title = body.title;
	if ('description' in body) updates.description = body.description;
	if ('estimated_amount' in body) updates.estimated_amount = body.estimated_amount;
	if ('approved_amount' in body) updates.approved_amount = body.approved_amount;
	if ('status' in body) updates.status = body.status;
	if ('approved_at' in body) updates.approved_at = body.approved_at;
	if ('billed_at' in body) updates.billed_at = body.billed_at;

	try {
		const order = await updateChangeOrder(params.id, updates);
		return json({ data: order });
	} catch (err) {
		console.error('[PATCH /api/admin/change-orders/:id]', err);
		const error = err instanceof Error ? err.message : 'Failed to update change order';
		return json({ error }, { status: 500 });
	}
};
