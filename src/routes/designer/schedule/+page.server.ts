import { requireStaffPage } from '$lib/server/designer';
import { getScheduleWeek } from '$lib/server/connecteam';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	await requireStaffPage(cookies, '/designer/schedule', ['designer', 'ops']);
	return getScheduleWeek({
		week: url.searchParams.get('week') || '',
		person: url.searchParams.get('person') || ''
	});
};
