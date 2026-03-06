import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getScopeDefinition, getTaskTemplatesByProjectType } from '$lib/server/db';
import { mapScopeToTasks } from '$lib/server/scope-mapper';
import type { PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies, params }) => {
	requireAdmin(cookies.get('admin_session'));

	const scope = await getScopeDefinition(params.dealId);
	if (!scope) {
		throw redirect(302, '/admin/scope');
	}

	const templates = await getTaskTemplatesByProjectType(scope.project_type);
	const taskSet = mapScopeToTasks(scope, templates);

	return {
		dealId: params.dealId,
		scope,
		taskSet
	};
};
