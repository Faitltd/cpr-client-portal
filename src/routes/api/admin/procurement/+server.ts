import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { createProcurementItem, getProcurementForDeal } from '$lib/server/db';
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
		const items = await getProcurementForDeal(dealId);
		return json({ data: items });
	} catch (err) {
		console.error('[GET /api/admin/procurement]', err);
		const error = err instanceof Error ? err.message : 'Failed to fetch procurement items';
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

	const { deal_id, item_name } = body ?? {};
	if (!deal_id) return json({ error: 'deal_id required' }, { status: 400 });
	if (!item_name) return json({ error: 'item_name required' }, { status: 400 });

	try {
		const item = await createProcurementItem(body);
		return json({ data: item }, { status: 201 });
	} catch (err) {
		console.error('[POST /api/admin/procurement]', err);
		const error = err instanceof Error ? err.message : 'Failed to create procurement item';
		return json({ error }, { status: 500 });
	}
};
