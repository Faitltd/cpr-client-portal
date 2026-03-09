import { json } from '@sveltejs/kit';
import { getCommsForDeal, getDailyLogsForDeal } from '$lib/server/db';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import type { RequestHandler } from './$types';

type ZohoDeal = {
	id?: string;
	Deal_Name?: string | null;
};

type ActivityItem = {
	type: 'comm' | 'daily_log';
	date: string;
	summary: string | null;
	channel?: string;
	deal_id: string;
};

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const deals = context.deals as ZohoDeal[];

		const activityByDeal = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				if (!dealId) return [];

				const [comms, dailyLogs] = await Promise.all([
					getCommsForDeal(dealId),
					getDailyLogsForDeal(dealId)
				]);

				const commActivity: ActivityItem[] = comms.map((entry) => ({
					type: 'comm',
					date: entry.created_at,
					summary: entry.subject || entry.summary,
					channel: entry.channel,
					deal_id: entry.deal_id
				}));

				const dailyLogActivity: ActivityItem[] = dailyLogs.map((entry) => ({
					type: 'daily_log',
					date: entry.created_at,
					summary: entry.work_completed,
					deal_id: entry.deal_id
				}));

				return [...commActivity, ...dailyLogActivity];
			})
		);

		const activity = activityByDeal
			.flat()
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
			.slice(0, 10);

		return json({ data: activity });
	} catch (err) {
		console.error('Failed to fetch client activity:', err);
		return json({ error: 'Failed to fetch activity' }, { status: 500 });
	}
};
