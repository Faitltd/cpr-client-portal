import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getScopeDefinition, getTaskTemplatesByProjectType } from '$lib/server/db';
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
		const scope = await getScopeDefinition(params.dealId);
		if (!scope) return json({ message: 'Scope definition not found' }, { status: 404 });

		const templates = await getTaskTemplatesByProjectType(scope.project_type);

		let mappedTasks: any[] = [];
		try {
			const { mapScopeToTasks } = await import('$lib/server/scope-mapper');
			const result = mapScopeToTasks(scope, templates);
			mappedTasks = result.tasks;
		} catch {
			// scope-mapper not yet implemented — return raw templates as fallback
			mappedTasks = templates.map((t) => ({
				...t,
				template_id: t.id,
				start_date: null,
				end_date: null,
				phase_order: 0,
				duration_days: t.default_duration_days
			}));
		}

		return json({ data: { scope, tasks: mappedTasks, totalTasks: mappedTasks.length } });
	} catch (err) {
		console.error('GET /api/admin/scope/[dealId]/preview error:', err);
		const message = err instanceof Error ? err.message : 'Failed to generate scope preview';
		return json({ message }, { status: 500 });
	}
};
