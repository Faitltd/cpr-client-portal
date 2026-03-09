import { json } from '@sveltejs/kit';
import {
	getCommsForDeal,
	getOpenFieldIssuesForDeal,
	getPendingApprovalsForDeal
} from '$lib/server/db';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import type { RequestHandler } from './$types';

type ZohoDeal = {
	id?: string;
	Deal_Name?: string | null;
};

type DealSnapshot = {
	deal_id: string;
	deal_name: string;
	pending_approvals: number;
	recent_activity: {
		date: string;
		summary: string;
		channel: string;
	}[];
	open_issues: number;
};

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const deals = context.deals as ZohoDeal[];

		const dealSummaries = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				const dealName = deal?.Deal_Name ?? '';

				if (!dealId) {
					return {
						deal_id: '',
						deal_name: dealName,
						pending_approvals: 0,
						recent_activity: [],
						open_issues: 0
					} satisfies DealSnapshot;
				}

				try {
					const [pendingApprovals, comms, openIssues] = await Promise.all([
						getPendingApprovalsForDeal(dealId, 'client'),
						getCommsForDeal(dealId),
						getOpenFieldIssuesForDeal(dealId)
					]);

					const recentActivity = [...comms]
						.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
						.slice(0, 5)
						.map((entry) => ({
							date: entry.created_at,
							summary: entry.subject || entry.summary || '',
							channel: entry.channel
						}));

					return {
						deal_id: dealId,
						deal_name: dealName,
						pending_approvals: pendingApprovals.length,
						recent_activity: recentActivity,
						open_issues: openIssues.length
					} satisfies DealSnapshot;
				} catch (err) {
					console.error(`Failed to compute client snapshot for deal ${dealId}:`, err);
					return {
						deal_id: dealId,
						deal_name: dealName,
						pending_approvals: 0,
						recent_activity: [],
						open_issues: 0
					} satisfies DealSnapshot;
				}
			})
		);

		const filteredDeals = dealSummaries.filter((deal) => deal.deal_id);
		const totalPending = filteredDeals.reduce((sum, deal) => sum + deal.pending_approvals, 0);

		return json({
			data: {
				deals: filteredDeals,
				total_pending: totalPending
			}
		});
	} catch (err) {
		console.error('Failed to fetch client snapshot:', err);
		return json({ error: 'Failed to fetch snapshot' }, { status: 500 });
	}
};
