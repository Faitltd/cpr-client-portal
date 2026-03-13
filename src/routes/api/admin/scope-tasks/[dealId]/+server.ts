import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getScopeTasksByDeal, bulkUpsertScopeTasks } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const data = await getScopeTasksByDeal(params.dealId);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch scope tasks';
		return json({ message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const tasks = body?.tasks;
	if (!Array.isArray(tasks)) {
		return json({ message: 'tasks array is required' }, { status: 400 });
	}

	try {
		const data = await bulkUpsertScopeTasks(params.dealId, tasks);
		return json({ data }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to save scope tasks';
		return json({ message }, { status: 500 });
	}
};
