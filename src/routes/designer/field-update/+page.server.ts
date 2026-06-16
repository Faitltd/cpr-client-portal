import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import { getAllFieldUpdates } from '$lib/server/zoho-field-updates';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

const ADMIN_EMAILS = new Set(
	(env.PORTAL_ADMIN_EMAILS ?? 'ray@homecpr.pro')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

// Admins get an all-field-updates oversight list; non-admin field/trade users
// (e.g. Jeff) get their own embedded field-update form.
export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal || principal.role !== 'designer') {
		throw redirect(302, '/auth/portal?next=/designer/field-update');
	}
	const email = (principal.session.designer.email ?? '').toLowerCase();

	if (ADMIN_EMAILS.has(email)) {
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
