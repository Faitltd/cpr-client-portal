import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import type { PageServerLoad } from './$types';

// The client dashboard is for homeowner (client) sessions only. Internal staff
// who hold a designer session are sent to the designer portal; anyone without a
// valid portal session is sent to log in. This keeps the empty client shell from
// showing to non-clients.
export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal) {
		throw redirect(302, '/auth/portal?next=/dashboard');
	}
	if (principal.role === 'designer') {
		throw redirect(302, '/designer');
	}
	return {};
};
