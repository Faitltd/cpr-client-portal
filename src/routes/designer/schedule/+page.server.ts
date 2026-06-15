import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import { getScheduleWeek } from '$lib/server/connecteam';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal || principal.role !== 'designer') {
		throw redirect(302, '/auth/portal?next=/designer/schedule');
	}
	return getScheduleWeek({
		week: url.searchParams.get('week') || '',
		person: url.searchParams.get('person') || ''
	});
};
