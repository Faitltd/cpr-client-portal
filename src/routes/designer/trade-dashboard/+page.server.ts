import { redirect } from '@sveltejs/kit';
import { getPortalPrincipal, getFieldDeals } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import { DESIGNER_DEAL_FIELD_DESCRIPTORS, type DealFieldDescriptor } from '$lib/types/designer';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

const ADMIN_EMAILS = new Set(
	(env.PORTAL_ADMIN_EMAILS ?? 'ray@homecpr.pro')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

// Admins get an all-field-projects oversight view; non-admin field/trade users
// (e.g. Jeff) get their own embedded trade dashboard.
export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal || principal.role !== 'designer') {
		throw redirect(302, '/auth/portal?next=/designer/trade-dashboard');
	}
	const email = (principal.session.designer.email ?? '').toLowerCase();
	const isAdmin = ADMIN_EMAILS.has(email);

	if (isAdmin) {
		let deals: Awaited<ReturnType<typeof getFieldDeals>> = [];
		let warning = '';
		try {
			deals = await getFieldDeals();
		} catch (err) {
			warning = err instanceof Error ? err.message : 'Unable to load field projects.';
		}
		const fieldDescriptors: DealFieldDescriptor[] = DESIGNER_DEAL_FIELD_DESCRIPTORS.map((d) => ({
			key: d.key,
			label: d.label,
			kind: d.kind,
			group: d.group,
			editable: d.editable,
			helpText: d.helpText
		}));
		return { isAdmin: true, deals, warning, fieldDescriptors };
	}

	if (!(await getTradePartnerAuthByEmail(email))) {
		throw redirect(302, '/designer');
	}
	return { isAdmin: false };
};
