import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getTaskTemplateById, updateTaskTemplate, deleteTaskTemplate } from '$lib/server/db';
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
		const data = await getTaskTemplateById(params.id);
		if (!data) return json({ message: 'Template not found' }, { status: 404 });
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch task template';
		return json({ message }, { status: 500 });
	}
};

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
	if (body.projectType !== undefined) mapped.project_type = body.projectType;
	if (body.phase !== undefined) mapped.phase = body.phase;
	if (body.taskName !== undefined) mapped.task_name = body.taskName;
	if (body.trade !== undefined) mapped.trade = body.trade;
	if (body.description !== undefined) mapped.description = body.description;
	if (body.defaultDurationDays !== undefined) mapped.default_duration_days = body.defaultDurationDays;
	if (body.dependencyKey !== undefined) mapped.dependency_key = body.dependencyKey;
	if (body.requiresInspection !== undefined) mapped.requires_inspection = body.requiresInspection;
	if (body.requiresClientDecision !== undefined) mapped.requires_client_decision = body.requiresClientDecision;
	if (body.materialLeadTimeDays !== undefined) mapped.material_lead_time_days = body.materialLeadTimeDays;
	if (body.sortOrder !== undefined) mapped.sort_order = body.sortOrder;
	if (body.isConditional !== undefined) mapped.is_conditional = body.isConditional;
	if (body.conditionKey !== undefined) mapped.condition_key = body.conditionKey;
	if (body.conditionValue !== undefined) mapped.condition_value = body.conditionValue;
	if (body.active !== undefined) mapped.active = body.active;

	try {
		const data = await updateTaskTemplate(params.id, mapped);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update task template';
		return json({ message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		await deleteTaskTemplate(params.id);
		return json({ message: 'Template deactivated' });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to deactivate task template';
		return json({ message }, { status: 500 });
	}
};
