import { error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getZohoApiBase, refreshAccessToken } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_API_BASE = env.ZOHO_API_BASE || '';

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

function safeFileName(value: string) {
	return value.replace(/[/\\]/g, '_').replace(/"/g, "'");
}

function addIdCandidate(candidates: Set<string>, value: unknown) {
	if (value === null || value === undefined) return;
	const text = String(value).trim();
	if (!text) return;
	candidates.add(text);
}

function collectIdCandidatesFromValue(value: any, candidates: Set<string>) {
	if (!value) return;
	if (Array.isArray(value)) {
		for (const item of value) collectIdCandidatesFromValue(item, candidates);
		return;
	}
	if (typeof value !== 'object') return;

	addIdCandidate(candidates, value.id);
	addIdCandidate(candidates, value.ID);
	addIdCandidate(candidates, value.Id);
	addIdCandidate(candidates, value.deal_id);
	addIdCandidate(candidates, value.Deal_ID);
}

function collectDealIdCandidates(deal: any) {
	const candidates = new Set<string>();
	if (!deal || typeof deal !== 'object') return candidates;

	addIdCandidate(candidates, deal.id);
	addIdCandidate(candidates, deal.crm_deal_id);
	addIdCandidate(candidates, deal.source_record_id);
	addIdCandidate(candidates, deal.sourceRecordId);
	addIdCandidate(candidates, deal.deal_id);
	addIdCandidate(candidates, deal.Deal_ID);

	for (const key of [
		'Deal',
		'Deal_Name',
		'Potential_Name',
		'Portal_Deal',
		'Portal_Deals',
		'Portal_Deals1',
		'Portal_Deals2',
		'Portal_Deals3',
		'Active_Deal',
		'Active_Deals',
		'Active_Deals1',
		'Active_Deals2',
		'Active_Deals3',
		'Project',
		'Project_Name'
	]) {
		collectIdCandidatesFromValue((deal as any)[key], candidates);
	}

	for (const [key, value] of Object.entries(deal)) {
		if (!/(^|_)deals?(\d+)?$/i.test(key) && !/(^|_)project(_name)?$/i.test(key)) continue;
		collectIdCandidatesFromValue(value, candidates);
	}

	return candidates;
}

function resolveDealIdForTradePartner(deals: any[], requestedDealId: string) {
	const requested = String(requestedDealId || '').trim();
	if (!requested) return null;

	for (const deal of deals || []) {
		const candidates = collectDealIdCandidates(deal);
		if (!candidates.has(requested)) continue;

		const canonical = String(deal?.id || '').trim();
		if (canonical) return canonical;

		for (const candidate of candidates) {
			if (/^\d{10,}$/.test(candidate)) return candidate;
		}
		return requested;
	}

	return null;
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		throw error(401, 'Invalid session');
	}

	const tradePartnerId = session.trade_partner.zoho_trade_partner_id;
	if (!tradePartnerId) {
		throw error(400, 'Trade partner is missing Zoho ID');
	}

	const dealId = params.dealId;
	const attachmentId = params.attachmentId;
	if (!dealId || !attachmentId) {
		throw error(400, 'Deal ID and attachment ID are required');
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
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

	const apiDomain = tokens.api_domain || undefined;
	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const resolvedDealId = resolveDealIdForTradePartner(deals, dealId);
	if (!resolvedDealId) {
		throw error(403, 'Access denied');
	}

	const base = getZohoApiBase(apiDomain) || ZOHO_API_BASE;
	const downloadUrl = `${base}/Deals/${resolvedDealId}/actions/download_fields_attachment?fields_attachment_id=${encodeURIComponent(attachmentId)}`;

	const response = await fetch(downloadUrl, {
		method: 'GET',
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`
		}
	});

	if (!response.ok) {
		const message = await response.text();
		throw error(response.status, message || 'Failed to download file');
	}

	const headers = new Headers();
	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	headers.set('Content-Type', contentType);
	const fileName = safeFileName(url.searchParams.get('fileName') || 'design-file');
	const download = url.searchParams.get('download') === '1';
	headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);

	return new Response(response.body, {
		status: response.status,
		headers
	});
};
