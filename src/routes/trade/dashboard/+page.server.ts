import { redirect } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { PageServerLoad } from './$types';

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

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		throw redirect(302, '/auth/trade');
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		throw redirect(302, '/auth/trade');
	}
	console.error('TP_DEBUG: trade dashboard load', {
		email: session.trade_partner.email,
		tradePartnerId: session.trade_partner.zoho_trade_partner_id || null
	});

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw redirect(302, '/auth/login');
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

	let deals: any[] = [];
	let warning = '';
	const dealFields = [
		'Deal_Name',
		'Stage',
		'Address',
		'Address_Line_2',
		'Street',
		'City',
		'State',
		'Zip_Code',
		'Garage_Code',
		'WiFi',
		'Notes1'
	].join(',');

	const fetchDealsByIds = async (ids: string[]) => {
		const results: any[] = [];
		const chunkSize = 100;
		for (let i = 0; i < ids.length; i += chunkSize) {
			const chunk = ids.slice(i, i + chunkSize);
			const response = await zohoApiCall(
				accessToken,
				`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(dealFields)}`
			);
			results.push(...(response.data || []));
		}
		return results;
	};

	if (!session.trade_partner.zoho_trade_partner_id) {
		warning = 'Your account is missing a Zoho Trade Partner ID. Contact admin to resync.';
	} else {
		const fetched = await getTradePartnerDeals(accessToken, session.trade_partner.zoho_trade_partner_id);
		const allDeals = Array.isArray(fetched) ? fetched : [];
		const missingStageIds = allDeals
			.filter((deal) => !deal?.Stage && deal?.id)
			.map((deal) => deal.id);

		let hydratedDeals = allDeals;
		if (missingStageIds.length > 0) {
			const hydrated = await fetchDealsByIds(missingStageIds);
			const hydratedMap = new Map(hydrated.map((deal) => [deal.id, deal]));
			hydratedDeals = allDeals.map((deal) => hydratedMap.get(deal.id) || deal);
		}

		deals = hydratedDeals;
	}

	return {
		tradePartner: session.trade_partner,
		deals,
		warning
	};
};
