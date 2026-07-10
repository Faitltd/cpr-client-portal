import { redirect } from '@sveltejs/kit';
import { getFieldDeals, requireStaffPage } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import { DESIGNER_DEAL_FIELD_DESCRIPTORS, type DealFieldDescriptor } from '$lib/types/designer';
import type { PageServerLoad } from './$types';

// Admins get an all-field-projects oversight view; ops users (Jeff) get their
// own embedded trade dashboard.
export const load: PageServerLoad = async ({ cookies }) => {
	const { email, isAdmin } = await requireStaffPage(cookies, '/designer/trade-dashboard', ['ops']);

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
