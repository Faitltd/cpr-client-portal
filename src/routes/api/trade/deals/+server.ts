import { json } from '@sveltejs/kit';
import { summarizeDeal } from '$lib/server/designer';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import {
	DESIGNER_DEAL_FIELD_DESCRIPTORS,
	type DealFieldDescriptor,
	type DesignerDealSummary
} from '$lib/types/designer';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const result = await loadTradePageContext(sessionToken, { includeDetailFields: true });

	if (result.redirectTo) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const designerDeals = (result.designerDeals ?? result.deals)
		.map((deal) => summarizeDeal(deal))
		.filter((deal): deal is DesignerDealSummary => Boolean(deal));

	return json({
		deals: result.deals,
		designerDeals,
		designerFieldDescriptors: DESIGNER_DEAL_FIELD_DESCRIPTORS.map(
			(d): DealFieldDescriptor => ({
				key: d.key,
				label: d.label,
				kind: d.kind,
				group: d.group,
				editable: false,
				helpText: d.helpText
			})
		),
		warning: result.warning,
		syncing: result.syncing ?? false
	});
};
