import { json } from '@sveltejs/kit';
import {
	getCommsForDeal,
	getOpenFieldIssuesForDeal,
	getPendingApprovalsForDeal,
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
