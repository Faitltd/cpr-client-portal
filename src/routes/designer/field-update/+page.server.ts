import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import type { PageServerLoad } from './$types';

// Designer-portal Field Update tab — only for designers who are also trade
// partners. The content is the existing trade field-update page, embedded.
export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal || principal.role !== 'designer') {
		throw redirect(302, '/auth/portal?next=/designer/field-update');
	}
	const email = (principal.session.designer.email ?? '').toLowerCase();
	if (!(await getTradePartnerAuthByEmail(email))) {
		throw redirect(302, '/designer');
	}
	return {};
};
