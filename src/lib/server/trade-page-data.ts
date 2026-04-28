import {
	getTradePartnerDeals,
	isTradePortalVisibleStage,
	normalizeDealRecord
} from '$lib/server/auth';
import {
	getTradeSession,
	getZohoTokens,
	type TradePartner,
	upsertZohoTokens
} from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const BASE_DEAL_FIELDS = [
	'Deal_Name',
	'Stage',
	'Address',
	'Address_Line_2',
	'Street',
	'City',
	'State',
	'Zip_Code'
];

const DETAIL_DEAL_FIELDS = ['Garage_Code', 'WiFi', 'Refined_Scope', 'File_Upload', 'Progress_Photos', 'Project_ID', 'Zoho_Projects_ID', 'Client_Portal_Folder', 'External_Link'];

export type LoadTradePageContextOptions = {
	includeDetailFields?: boolean;
};

export type TradePageContext = {
	redirectTo: string | null;
	tradePartner: TradePartner | null;
	deals: any[];
	warning: string;
};

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

function getTradePageDealFields(includeDetailFields: boolean) {
	return [...BASE_DEAL_FIELDS, ...(includeDetailFields ? DETAIL_DEAL_FIELDS : [])].join(',');
}

export function getTradeDealLabel(deal: any): string | null {
	return (
		deal?.Deal_Name ||
		deal?.Potential_Name ||
		deal?.Name ||
		deal?.name ||
		deal?.Subject ||
		deal?.Full_Name ||
		deal?.Display_Name ||
		deal?.display_name ||
		null
	);
}

export function isPlaceholderTradeDealName(name: string | null) {
	if (!name) return false;
	return /^deal\s+\d+$/i.test(name.trim());
}

function hasTradeDealUsefulData(deal: any, includeDetailFields: boolean) {
	const baseData = Boolean(
		deal?.Address || deal?.Street || deal?.City || deal?.State || deal?.Zip_Code || deal?.Stage
	);
	if (baseData) return true;
	if (!includeDetailFields) return false;

	return Boolean(
		deal?.Garage_Code ||
			deal?.WiFi ||
			deal?.Refined_Scope ||
			deal?.File_Upload ||
			deal?.Progress_Photos
	);
}

export function isTradeDealDisplayable(deal: any, includeDetailFields = false) {
	const label = getTradeDealLabel(deal);
	if (label && !isPlaceholderTradeDealName(label)) return true;
	return hasTradeDealUsefulData(deal, includeDetailFields);
}

function withTradeDealFallbackName(deal: any) {
	if (!deal || typeof deal !== 'object') return deal;
	const dealId = String(deal?.id || '').trim();
	if (!dealId) return deal;

	const label = getTradeDealLabel(deal);
	if (label) return deal;

	return {
		...deal,
		Deal_Name: `Deal ${dealId.slice(-6)}`
	};
}

export function shouldHydrateTradeDeal(deal: any, includeDetailFields = false) {
	const dealId = String(deal?.id || '').trim();
	if (!dealId) return false;
	if (!deal?.Stage) return true;
	if (!isTradeDealDisplayable(deal, includeDetailFields)) return true;
	if (!includeDetailFields) return false;
	return (
		typeof deal?.Garage_Code === 'undefined' ||
		typeof deal?.File_Upload === 'undefined' ||
		typeof deal?.Progress_Photos === 'undefined'
	);
}

export function finalizeTradePageDeals(deals: any[], includeDetailFields = false) {
	const normalized = (deals || [])
		.filter((deal) => deal && typeof deal === 'object' && String(deal?.id || '').trim())
		.map((deal) => withTradeDealFallbackName(deal));

	const displayable = normalized.filter((deal) => isTradeDealDisplayable(deal, includeDetailFields));
	return displayable.length > 0 ? displayable : normalized;
}

async function fetchDealsByIds(
	accessToken: string,
	ids: string[],
	includeDetailFields: boolean,
	apiDomain?: string
) {
	const results: any[] = [];
	const fields = getTradePageDealFields(includeDetailFields);
	const chunkSize = 100;

	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		const response = await zohoApiCall(
			accessToken,
			`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields)}`,
			{},
			apiDomain
		);
		results.push(...(response.data || []));
	}

	return results.map(normalizeDealRecord);
}

export async function loadTradePageContext(
	sessionToken: string | null | undefined,
	options: LoadTradePageContextOptions = {}
): Promise<TradePageContext> {
	const includeDetailFields = Boolean(options.includeDetailFields);

	if (!sessionToken) {
		return {
			redirectTo: '/auth/trade',
			tradePartner: null,
			deals: [],
			warning: ''
		};
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return {
			redirectTo: '/auth/trade',
			tradePartner: null,
			deals: [],
			warning: ''
		};
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		return {
			redirectTo: '/auth/login',
			tradePartner: null,
			deals: [],
			warning: ''
		};
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

	const apiDomain = tokens.api_domain || undefined;
	const tradePartnerZohoId = String(session.trade_partner?.zoho_trade_partner_id || '').trim();

	if (!tradePartnerZohoId) {
		return {
			redirectTo: null,
			tradePartner: session.trade_partner,
			deals: [],
			warning: 'Your trade partner account is not linked to Zoho yet. Please contact your admin.'
		};
	}

	try {
		const allDeals = await getTradePartnerDeals(accessToken, tradePartnerZohoId, apiDomain);
		const hydrateIds = Array.from(
			new Set(
				allDeals
					.filter((deal) => shouldHydrateTradeDeal(deal, includeDetailFields))
					.map((deal) => String(deal.id))
					.filter(Boolean)
			)
		);

		let hydratedDeals = allDeals;
		if (hydrateIds.length > 0) {
			try {
				const hydrated = await fetchDealsByIds(
					accessToken,
					hydrateIds,
					includeDetailFields,
					apiDomain
				);
				const hydratedMap = new Map(hydrated.map((deal) => [deal.id, deal]));
				hydratedDeals = allDeals.map((deal) => hydratedMap.get(deal.id) || deal);
			} catch {
				// Hydration failed — continue with un-hydrated deals
			}
		}

		const visibleDeals = hydratedDeals.filter((deal) => isTradePortalVisibleStage(deal?.Stage));
		deals = finalizeTradePageDeals(visibleDeals, includeDetailFields);

		if (deals.length === 0) {
			warning =
				'No deals found in Quoted or Project Created. Please try again later or contact your admin.';
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[trade-page-data] Failed to load deals:', message);
		warning = 'Unable to load deals at this time. Please try again later or contact your admin.';
	}

	return {
		redirectTo: null,
		tradePartner: session.trade_partner,
		deals,
		warning
	};
}
