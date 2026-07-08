import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import type { PageServerLoad } from './$types';

// The Home Building Checklist is a client resource. Gate it behind the same
// client (homeowner) session as the dashboard: designers go to their portal,
// anyone without a portal session is sent to log in.
export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal) {
		throw redirect(302, '/auth/portal?next=/resources/checklist');
	}
	if (principal.role === 'designer') {
		throw redirect(302, '/designer');
	}
	return {};
};
