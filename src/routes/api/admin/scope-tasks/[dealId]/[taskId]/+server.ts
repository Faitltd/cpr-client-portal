import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { deleteScopeTask } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		await deleteScopeTask(params.taskId);
		return json({ message: 'Task deleted' });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to delete scope task';
		return json({ message }, { status: 500 });
	}
};
