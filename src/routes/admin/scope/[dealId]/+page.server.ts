import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies, params }) => {
	requireAdmin(cookies.get('admin_session'));
	return { dealId: params.dealId };
};
