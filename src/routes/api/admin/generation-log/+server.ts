import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { createGenerationLog, getLatestGenerationLog, getGenerationLogsByDeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = url.searchParams.get('dealId');
	if (!dealId) {
		return json({ message: 'dealId is required' }, { status: 400 });
	}

	const latest = url.searchParams.get('latest');

	try {
		if (latest === 'true') {
			const data = await getLatestGenerationLog(dealId);
			return json({ data: data ?? null });
		}
		const data = await getGenerationLogsByDeal(dealId);
		return json({ data });
	} catch (err) {
		console.error('[GET /api/admin/generation-log]', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch generation logs';
		return json({ message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const { dealId } = body ?? {};
	if (!dealId) {
		return json({ message: 'dealId is required' }, { status: 400 });
	}

	try {
		const data = await createGenerationLog({
			deal_id: String(dealId),
			scope_definition_id: body.scopeDefinitionId ?? undefined,
			tasks_total: body.tasksTotal ?? undefined
		});
		return json({ data }, { status: 201 });
	} catch (err) {
		console.error('[POST /api/admin/generation-log]', err);
		const message = err instanceof Error ? err.message : 'Failed to create generation log';
		return json({ message }, { status: 500 });
	}
};
