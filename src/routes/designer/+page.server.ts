import { redirect } from '@sveltejs/kit';
import { getDesignerDashboardContext } from '$lib/server/designer';
import {
	DESIGNER_DEAL_FIELD_DESCRIPTORS,
	type DealFieldDescriptor
} from '$lib/types/designer';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const context = await getDesignerDashboardContext(cookies.get('portal_session'));
	if (!context) {
		throw redirect(302, '/auth/portal?next=/designer');
	}

	return {
		deals: context.deals,
		warning: context.warning,
		fieldDescriptors: DESIGNER_DEAL_FIELD_DESCRIPTORS.map((d): DealFieldDescriptor => ({
			key: d.key,
			label: d.label,
			kind: d.kind,
			group: d.group,
			editable: d.editable,
			helpText: d.helpText
		}))
	};
};
