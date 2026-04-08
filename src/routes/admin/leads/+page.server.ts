import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/login');
	}
	return {};
};
