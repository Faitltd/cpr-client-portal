import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));

	if (!principal) {
		throw redirect(302, '/auth/portal?next=/designer');
	}

	if (principal.role !== 'designer') {
		// Authenticated but wrong role — send clients to their own dashboard.
		throw redirect(302, '/dashboard');
	}

	return {
		designer: principal.session.designer
	};
};
