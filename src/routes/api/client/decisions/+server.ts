import { json } from '@sveltejs/kit';
import {
	getApprovalsForDeal,
	getSession,
	getZohoTokens,
	updateApprovalStatus,
	upsertZohoTokens
} from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

type ZohoDeal = {
	id?: string;
	Deal_Name?: string | null;
};

type DecisionStatus = 'approved' | 'rejected' | 'deferred';

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

		const approvalsByDeal = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				if (!dealId) return [];

				const approvals = await getApprovalsForDeal(dealId);
				return approvals
					.filter((approval) => approval.assigned_to === 'client')
					.map((approval) => ({
						...approval,
						deal_name: deal?.Deal_Name ?? ''
					}));
			})
		);

		const approvals = approvalsByDeal.flat().sort((a, b) => {
			return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
		});

		return json({ data: approvals });
	} catch (err) {
		console.error('Failed to fetch decisions:', err);
		return json({ error: 'Failed to fetch decisions' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ cookies, request }) => {
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

		const body = await request.json().catch(() => ({}));
		const id = String(body?.id || '').trim();
		const status = body?.status;
		const responseNoteRaw =
			typeof body?.response_note === 'string'
				? body.response_note
				: typeof body?.responseNote === 'string'
					? body.responseNote
					: undefined;

		if (
			!id ||
			(status !== 'approved' && status !== 'rejected' && status !== 'deferred')
		) {
			return json({ error: 'Invalid request body' }, { status: 400 });
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
		const dealIds = deals
			.map((deal) => String(deal?.id || '').trim())
			.filter((dealId) => Boolean(dealId));

		const approvalsByDeal = await Promise.all(
			dealIds.map(async (dealId) => {
				const approvals = await getApprovalsForDeal(dealId);
				return approvals;
			})
		);

		const clientApproval = approvalsByDeal
			.flat()
			.find((approval) => approval.id === id && approval.assigned_to === 'client');

		if (!clientApproval) {
			return json({ error: 'Approval not found' }, { status: 404 });
		}

		const updated = await updateApprovalStatus(
			id,
			status as DecisionStatus,
			typeof responseNoteRaw === 'string' && responseNoteRaw.trim().length > 0
				? responseNoteRaw.trim()
				: undefined
		);

		return json({ data: updated });
	} catch (err) {
		console.error('Failed to update decision:', err);
		return json({ error: 'Failed to update decision' }, { status: 500 });
	}
};
