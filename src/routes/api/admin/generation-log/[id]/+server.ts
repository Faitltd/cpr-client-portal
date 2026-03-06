import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { updateGenerationLog } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
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
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const mapped: Record<string, unknown> = {};
	if ('status' in body)             mapped.status = body.status;
	if ('zohoProjectId' in body)      mapped.zoho_project_id = body.zohoProjectId;
	if ('phasesCreated' in body)      mapped.phases_created = body.phasesCreated;
	if ('tasklistsCreated' in body)   mapped.tasklists_created = body.tasklistsCreated;
	if ('tasksCreated' in body)       mapped.tasks_created = body.tasksCreated;
	if ('tasksTotal' in body)         mapped.tasks_total = body.tasksTotal;
	if ('lastCompletedStep' in body)  mapped.last_completed_step = body.lastCompletedStep;
	if ('errorMessage' in body)       mapped.error_message = body.errorMessage;
	if ('completedAt' in body)        mapped.completed_at = body.completedAt;

	try {
		const data = await updateGenerationLog(params.id, mapped);
		return json({ data });
	} catch (err) {
		console.error('[PATCH /api/admin/generation-log/:id]', err);
		const message = err instanceof Error ? err.message : 'Failed to update generation log';
		return json({ message }, { status: 500 });
	}
};
