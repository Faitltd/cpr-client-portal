import { json } from '@sveltejs/kit';
import {
	createFieldIssue,
	getFieldIssuesByTradePartner,
	getTradeSession,
	getZohoTokens,
	upsertZohoTokens
} from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const VALID_ISSUE_TYPES = new Set([
	'damaged_material',
	'field_conflict',
	'missing_info',
	'access_issue',
	'design_conflict',
	'unexpected_condition',
	'safety'
]);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) {
		return date.toISOString();
	}
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.toISOString();
		}
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

async function getAccessToken() {
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
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return accessToken;
}

async function isDealAuthorizedForTradePartner(dealId: string, zohoTradePartnerId: string) {
	const accessToken = await getAccessToken();
	const result = await getTradePartnerDeals(accessToken, zohoTradePartnerId);
	const dealList = Array.isArray(result.deals) ? result.deals : [];
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const session = await getTradeSession(token);
		if (!session || new Date(session.expires_at) < new Date()) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const dealId = String(url.searchParams.get('dealId') || '').trim();
		if (!dealId) {
			return json({ error: 'Missing dealId query param' }, { status: 400 });
		}

		if (!session.trade_partner?.zoho_trade_partner_id) {
			return json({ error: 'Trade partner is missing Zoho ID' }, { status: 400 });
		}

		const authorized = await isDealAuthorizedForTradePartner(
			dealId,
			session.trade_partner.zoho_trade_partner_id
		);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this trade partner' }, { status: 403 });
		}

		const issues = await getFieldIssuesByTradePartner(dealId, session.trade_partner_id);
		return json({ data: issues });
	} catch (err) {
		console.error('Failed to fetch field issues:', err);
		return json({ error: 'Failed to fetch field issues' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const session = await getTradeSession(token);
		if (!session || new Date(session.expires_at) < new Date()) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json().catch(() => ({}));
		const dealId = String(body?.deal_id || '').trim();
		const issueType = String(body?.issue_type || '').trim();
		const title = String(body?.title || '').trim();
		const severity = body?.severity ? String(body.severity).trim() : 'medium';
		const description = typeof body?.description === 'string' ? body.description : null;
		const photoIds = body?.photo_ids;

		if (!dealId) {
			return json({ error: 'Missing required field: deal_id' }, { status: 400 });
		}
		if (!issueType) {
			return json({ error: 'Missing required field: issue_type' }, { status: 400 });
		}
		if (!title) {
			return json({ error: 'Missing required field: title' }, { status: 400 });
		}
		if (!VALID_ISSUE_TYPES.has(issueType)) {
			return json(
				{
					error:
						'Invalid issue_type. Must be one of: damaged_material, field_conflict, missing_info, access_issue, design_conflict, unexpected_condition, safety'
				},
				{ status: 400 }
			);
		}
		if (!VALID_SEVERITIES.has(severity)) {
			return json(
				{ error: 'Invalid severity. Must be one of: low, medium, high, critical' },
				{ status: 400 }
			);
		}
		if (description !== null && typeof description !== 'string') {
			return json({ error: 'Invalid description. Must be a string when provided' }, { status: 400 });
		}
		if (
			photoIds !== undefined &&
			photoIds !== null &&
			(!Array.isArray(photoIds) || !photoIds.every((item: unknown) => typeof item === 'string'))
		) {
			return json({ error: 'Invalid photo_ids. Must be an array of strings' }, { status: 400 });
		}

		if (!session.trade_partner?.zoho_trade_partner_id) {
			return json({ error: 'Trade partner is missing Zoho ID' }, { status: 400 });
		}

		const authorized = await isDealAuthorizedForTradePartner(
			dealId,
			session.trade_partner.zoho_trade_partner_id
		);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this trade partner' }, { status: 403 });
		}

		const created = await createFieldIssue({
			deal_id: dealId,
			trade_partner_id: session.trade_partner_id,
			issue_type: issueType as
				| 'damaged_material'
				| 'field_conflict'
				| 'missing_info'
				| 'access_issue'
				| 'design_conflict'
				| 'unexpected_condition'
				| 'safety',
			severity: severity as 'low' | 'medium' | 'high' | 'critical',
			title,
			description: description ?? null,
			photo_ids: photoIds ?? null,
			status: 'open'
		});

		return json({ data: created }, { status: 201 });
	} catch (err) {
		console.error('Failed to create field issue:', err);
		return json({ error: 'Failed to create field issue' }, { status: 500 });
	}
};
