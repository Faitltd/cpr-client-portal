import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { createChangeOrder, getChangeOrdersForDeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = url.searchParams.get('dealId');
	if (!dealId) return json({ error: 'dealId required' }, { status: 400 });

	try {
		const orders = await getChangeOrdersForDeal(dealId);
		return json({ data: orders });
	} catch (err) {
		console.error('[GET /api/admin/change-orders]', err);
		const error = err instanceof Error ? err.message : 'Failed to fetch change orders';
		return json({ error }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { deal_id, title } = body ?? {};
	if (!deal_id) return json({ error: 'deal_id required' }, { status: 400 });
	if (!title) return json({ error: 'title required' }, { status: 400 });

	try {
		const order = await createChangeOrder(body);
		return json({ data: order }, { status: 201 });
	} catch (err) {
		console.error('[POST /api/admin/change-orders]', err);
		const error = err instanceof Error ? err.message : 'Failed to create change order';
		return json({ error }, { status: 500 });
	}
};
