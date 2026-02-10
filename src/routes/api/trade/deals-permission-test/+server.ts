import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTokenInfo, refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	ZOHO_TRADE_PARTNERS_MODULE,
	ZOHO_TRADE_PARTNER_RELATED_LIST
} from '$env/static/private';
import type { RequestHandler } from './$types';

const DEAL_FIELDS = [
	'Deal_Name',
	'Stage',
	'Amount',
	'Closing_Date',
	'Created_Time',
	'Modified_Time',
	'Owner',
	'Contact_Name',
	'Account_Name',
	'Address',
	'Address_Line_2',
	'Street',
	'City',
	'State',
	'Zip_Code',
	'Garage_Code',
	'WiFi',
	'Refined_SOW',
	'File_Upload',
	'External_Link',
	'Portal_Trade_Partners'
].join(',');

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function parseList(value: string | undefined, fallback: string) {
	return (value || fallback)
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

export const GET: RequestHandler = async ({ cookies }) => {
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

	const modules = parseList(ZOHO_TRADE_PARTNERS_MODULE, 'Trade_Partners');
	const relatedLists = parseList(ZOHO_TRADE_PARTNER_RELATED_LIST, 'Deals3');

	let tokenInfo: Record<string, unknown> | null = null;
	try {
		tokenInfo = await getTokenInfo(accessToken);
	} catch (err) {
		tokenInfo = { error: err instanceof Error ? err.message : String(err) };
	}

	let currentUser: Record<string, unknown> | null = null;
	try {
		const response = await zohoApiCall(accessToken, '/users?type=CurrentUser', {});
		const user = response.users?.[0];
		if (user) {
			currentUser = {
				id: user.id,
				email: user.email,
				full_name: user.full_name,
				role: user.role?.name,
				profile: user.profile?.name
			};
		}
	} catch (err) {
		currentUser = { error: err instanceof Error ? err.message : String(err) };
	}

	const relatedListResults: Array<Record<string, unknown>> = [];
	let firstRelatedRecord: any | null = null;
	let firstRelatedSource: { moduleName: string; relatedList: string } | null = null;

	for (const moduleName of modules) {
		for (const relatedList of relatedLists) {
			try {
				const response = await zohoApiCall(
					accessToken,
					`/${moduleName}/${tradePartnerId}/${relatedList}?fields=${encodeURIComponent(DEAL_FIELDS)}`,
					{}
				);
				const deals = response.data || [];
				const sample = deals[0] || null;
				relatedListResults.push({
					moduleName,
					relatedList,
					count: deals.length,
					sampleKeys: sample ? Object.keys(sample) : []
				});
				if (!firstRelatedRecord && deals.length > 0) {
					firstRelatedRecord = sample;
					firstRelatedSource = { moduleName, relatedList };
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				relatedListResults.push({ moduleName, relatedList, error: message });
			}
		}
	}

	const ids = firstRelatedRecord?.id ? [firstRelatedRecord.id] : [];
	const dealsByIds: Record<string, unknown> = { idsCount: ids.length };

	if (ids.length > 0) {
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Deals?ids=${ids.join(',')}&fields=${encodeURIComponent(DEAL_FIELDS)}`,
				{}
			);
			const data = response.data || [];
			dealsByIds.listCount = data.length;
			dealsByIds.listSampleKeys = data[0] ? Object.keys(data[0]) : [];
		} catch (err) {
			dealsByIds.listError = err instanceof Error ? err.message : String(err);
		}

		try {
			const response = await zohoApiCall(
				accessToken,
				`/Deals/${ids[0]}?fields=${encodeURIComponent(DEAL_FIELDS)}`,
				{}
			);
			const data = response.data || [];
			dealsByIds.singleCount = data.length;
			dealsByIds.singleSampleKeys = data[0] ? Object.keys(data[0]) : [];
		} catch (err) {
			dealsByIds.singleError = err instanceof Error ? err.message : String(err);
		}
	}

	return json({
		tradePartnerId,
		modules,
		relatedLists,
		tokenInfo,
		currentUser,
		relatedListResults,
		firstRelatedSource,
		firstRelatedRecord: firstRelatedRecord
			? {
					id: firstRelatedRecord.id,
					Deal_Name: firstRelatedRecord.Deal_Name,
					keys: Object.keys(firstRelatedRecord)
				}
			: null,
		dealsByIds
	});
};
