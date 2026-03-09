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

		const countsByDeal = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				if (!dealId) return 0;

				const approvals = await getPendingApprovalsForDeal(dealId, 'client');
				return approvals.length;
			})
		);

		const totalCount = countsByDeal.reduce((sum, count) => sum + count, 0);
		return json({ data: { count: totalCount } });
	} catch (err) {
		console.error('Failed to fetch pending client approval count:', err);
		return json({ error: 'Failed to fetch pending count' }, { status: 500 });
	}
};
