import { json } from '@sveltejs/kit';
import {
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
