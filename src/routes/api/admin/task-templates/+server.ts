import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getTaskTemplatesByProjectType, getDistinctProjectTypes, createTaskTemplate } from '$lib/server/db';
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

	const projectType = url.searchParams.get('projectType');

	try {
		if (projectType) {
			const data = await getTaskTemplatesByProjectType(projectType);
			return json({ data });
		}
		const data = await getDistinctProjectTypes();
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch task templates';
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

	const { projectType, phase, taskName } = body ?? {};
	if (!projectType || !phase || !taskName) {
		return json({ message: 'projectType, phase, and taskName are required' }, { status: 400 });
	}

	try {
		const data = await createTaskTemplate({
			project_type: String(projectType),
			phase: String(phase),
			task_name: String(taskName),
			trade: body.trade ?? null,
			description: body.description ?? null,
			default_duration_days: body.defaultDurationDays ?? 1,
			dependency_key: body.dependencyKey ?? null,
			requires_inspection: body.requiresInspection ?? false,
			requires_client_decision: body.requiresClientDecision ?? false,
			material_lead_time_days: body.materialLeadTimeDays ?? 0,
			sort_order: body.sortOrder ?? 0,
			is_conditional: body.isConditional ?? false,
			condition_key: body.conditionKey ?? null,
			condition_value: body.conditionValue ?? null,
			active: body.active ?? true
		});
		return json({ data }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to create task template';
		return json({ message }, { status: 500 });
	}
};
