import { json } from '@sveltejs/kit';
import {
	getMyDailyLogsForDeal,
	getTradeSession,
	getZohoTokens,
	supabase,
	upsertDailyLog,
	upsertZohoTokens
} from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

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
	const dealList = await getTradePartnerDeals(accessToken, zohoTradePartnerId);
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

function getTodayDateString() {
	return new Date().toISOString().split('T')[0];
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

		const logs = await getMyDailyLogsForDeal(dealId, session.trade_partner_id);
		const enriched = logs.map((log) => {
			if (!log.photo_ids?.length) return { ...log, photo_urls: null };
			const photo_urls = log.photo_ids.map(
				(id) => supabase.storage.from('trade-photos').getPublicUrl(id).data.publicUrl
			);
			return { ...log, photo_urls };
		});
		return json({ data: enriched });
	} catch (err) {
		console.error('Failed to fetch daily logs:', err);
		return json({ error: 'Failed to fetch daily logs' }, { status: 500 });
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
		const dealId = String(body?.dealId || '').trim();

		if (!dealId) {
			return json({ error: 'Missing required field: dealId' }, { status: 400 });
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

		const logDate =
			typeof body?.logDate === 'string' && body.logDate.trim()
				? body.logDate.trim()
				: getTodayDateString();
		const hoursWorked =
			typeof body?.hoursWorked === 'number' && Number.isFinite(body.hoursWorked)
				? body.hoursWorked
				: null;
		const workCompleted =
			typeof body?.workCompleted === 'string' && body.workCompleted.trim()
				? body.workCompleted.trim()
				: null;
		const workPlanned =
			typeof body?.workPlanned === 'string' && body.workPlanned.trim()
				? body.workPlanned.trim()
				: null;
		const issuesEncountered =
			typeof body?.issuesEncountered === 'string' && body.issuesEncountered.trim()
				? body.issuesEncountered.trim()
				: null;
		const weatherDelay = body?.weatherDelay === true;
		const photoIds =
			Array.isArray(body?.photoIds) && body.photoIds.every((id: unknown) => typeof id === 'string')
				? body.photoIds
				: null;

		const log = await upsertDailyLog({
			deal_id: dealId,
			trade_partner_id: session.trade_partner_id,
			log_date: logDate,
			hours_worked: hoursWorked,
			work_completed: workCompleted,
			work_planned: workPlanned,
			issues_encountered: issuesEncountered,
			photo_ids: photoIds,
			weather_delay: weatherDelay
		});

		return json({ data: log }, { status: 201 });
	} catch (err) {
		console.error('Failed to submit daily log:', err);
		return json({ error: 'Failed to submit daily log' }, { status: 500 });
	}
};
