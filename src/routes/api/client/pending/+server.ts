import { json } from '@sveltejs/kit';
import { getPendingApprovalsForDeal } from '$lib/server/db';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import type { RequestHandler } from './$types';

type ZohoDeal = {
	id?: string;
	Deal_Name?: string | null;
};

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const deals = context.deals as ZohoDeal[];

		const pendingByDeal = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				if (!dealId) return [];

				const approvals = await getPendingApprovalsForDeal(dealId, 'client');
				return approvals.map((approval) => ({
					...approval,
					deal_name: deal?.Deal_Name ?? ''
				}));
			})
		);

		const items = pendingByDeal.flat();
		return json({ count: items.length, data: items });
	} catch (err) {
		console.error('Failed to fetch pending client approvals:', err);
		return json({ error: 'Failed to fetch pending items' }, { status: 500 });
	}
};
