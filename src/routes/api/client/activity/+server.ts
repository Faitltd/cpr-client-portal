import { json } from '@sveltejs/kit';
import {
	getCommsForDeal,
	getDailyLogsForDeal,
	getSession,
	getZohoTokens,
	upsertZohoTokens
} from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
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
	if (!sessionToken) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const session = await getSession(sessionToken);
		if (
			!session ||
			new Date(session.expires_at) < new Date() ||
			!session.client?.zoho_contact_id
		) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const tokens = await getZohoTokens();
		if (!tokens) {
			throw new Error('Zoho tokens not configured');
		}

		let accessToken = tokens.access_token;
		if (new Date(tokens.expires_at) < new Date()) {
			const refreshed = await refreshAccessToken(tokens.refresh_token);
			accessToken = refreshed.access_token;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: refreshed.refresh_token,
				expires_at: new Date(refreshed.expires_at).toISOString(),
				scope: tokens.scope
			});
		}

		const zohoContactId = session.client.zoho_contact_id;
		const dealsResponse = await fetch(
			`https://www.zohoapis.com/crm/v2/Deals/search?criteria=(Contact_Name:equals:${zohoContactId})`,
			{
				method: 'GET',
				headers: {
					Authorization: `Zoho-oauthtoken ${accessToken}`
				}
			}
		);

		if (!dealsResponse.ok) {
			const responseText = await dealsResponse.text().catch(() => '');
			throw new Error(`Zoho deals fetch failed (${dealsResponse.status}): ${responseText}`);
		}

		const payload = await dealsResponse.json().catch(() => ({}));
		const deals = Array.isArray(payload?.data) ? (payload.data as ZohoDeal[]) : [];

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
