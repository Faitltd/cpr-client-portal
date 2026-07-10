import { redirect } from '@sveltejs/kit';
import { requireStaffPage } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import { getAllFieldUpdates } from '$lib/server/zoho-field-updates';
import type { PageServerLoad } from './$types';

// Admins get an all-field-updates oversight list; designer and ops users get
// their own embedded field-update form (authenticated via their trade session).
export const load: PageServerLoad = async ({ cookies }) => {
	const { email, isAdmin } = await requireStaffPage(cookies, '/designer/field-update', [
		'designer',
		'ops'
	]);

	if (isAdmin) {
		let updates: Awaited<ReturnType<typeof getAllFieldUpdates>> = [];
		let warning = '';
		try {
			updates = await getAllFieldUpdates(150);
		} catch (err) {
			warning = err instanceof Error ? err.message : 'Unable to load field updates.';
		}
		return { isAdmin: true, updates, warning };
	}

	if (!(await getTradePartnerAuthByEmail(email))) {
		throw redirect(302, '/designer');
	}
	return { isAdmin: false };
};
