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

const DETAIL_DEAL_FIELDS = [
	'Garage_Code',
	'WiFi',
	'Refined_Scope',
	'File_Upload',
	'Progress_Photos',
	'Project_ID',
	'Zoho_Projects_ID',
	'Client_Portal_Folder',
	'External_Link'
];

const ZOHO_TIMEOUT_MS = 2500;

export type LoadTradePageContextOptions = {
	includeDetailFields?: boolean;
};

export type TradePageContext = {
	redirectTo: string | null;
	tradePartner: TradePartner | null;
	deals: any[];
	warning: string;
	syncing?: boolean;
};

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
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

function hasGarageCodeValue(value: unknown) {
	return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
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
	return { ...deal, Deal_Name: `Deal ${dealId.slice(-6)}` };
}

export function shouldHydrateTradeDeal(deal: any, includeDetailFields = false) {
	const dealId = String(deal?.id || '').trim();
	if (!dealId) return false;
	if (!deal?.Stage) return true;
	if (!isTradeDealDisplayable(deal, includeDetailFields)) return true;
	if (!includeDetailFields) return false;
	return (
		!hasGarageCodeValue(deal?.Garage_Code) ||
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

/** Wraps a promise with a hard timeout. Rejects with Error('timeout') if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`Zoho call timed out after ${ms}ms`)), ms)
		)
	]);
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
		const response = await withTimeout(
			zohoApiCall(
				accessToken,
				`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields)}`,
				{},
				apiDomain
			),
			ZOHO_TIMEOUT_MS
		);
		const bulkDeals = (response.data || []).map(normalizeDealRecord);
		const dealsById = new Map<string, any>(
			bulkDeals
				.map((deal) => {
					const dealId = String(deal?.id || '').trim();
					return dealId ? ([dealId, deal] as const) : null;
				})
				.filter(Boolean) as Array<readonly [string, any]>
		);

		const needsFallbackIds = chunk.filter((id) => {
			const bulkDeal = dealsById.get(String(id));
			if (!bulkDeal) return true;
			return includeDetailFields && shouldHydrateTradeDeal(bulkDeal, true);
		});

		for (const id of needsFallbackIds) {
			try {
				const fallback = await withTimeout(
					zohoApiCall(
						accessToken,
						`/Deals/${id}?fields=${encodeURIComponent(fields)}`,
						{},
						apiDomain
					),
					ZOHO_TIMEOUT_MS
				);
				const deal = fallback.data?.[0];
				if (deal) dealsById.set(String(id), normalizeDealRecord(deal));
			} catch {
				// Continue with bulk result on hydration failure
			}
		}

		for (const id of chunk) {
			const deal = dealsById.get(String(id));
			if (deal) results.push(deal);
		}
	}

	return results;
}

export async function loadTradePageContext(
	sessionToken: string | null | undefined,
	options: LoadTradePageContextOptions = {}
): Promise<TradePageContext> {
	const t0 = Date.now();
	const includeDetailFields = Boolean(options.includeDetailFields);

	if (!sessionToken) {
		return { redirectTo: '/auth/trade', tradePartner: null, deals: [], warning: '' };
	}

	// --- getSession ---
	const t1 = Date.now();
	const session = await getTradeSession(sessionToken);
	console.log(`[trade-dashboard] getSession ms=${Date.now() - t1}`);

	if (!session) {
		return { redirectTo: '/auth/trade', tradePartner: null, deals: [], warning: '' };
	}

	// --- getTradePartner ---
	console.log(`[trade-dashboard] getTradePartner ms=0 (inline session)`);

	// --- Zoho tokens ---
	const t2 = Date.now();
	const tokens = await getZohoTokens();
	console.log(`[trade-dashboard] getZohoTokens ms=${Date.now() - t2}`);

	if (!tokens) {
		return { redirectTo: '/auth/login', tradePartner: null, deals: [], warning: '' };
	}

	// --- Token refresh (if needed) ---
	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const t3 = Date.now();
		try {
			const refreshed = await withTimeout(refreshAccessToken(tokens.refresh_token), ZOHO_TIMEOUT_MS);
			accessToken = refreshed.access_token;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: refreshed.refresh_token,
				expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
				scope: tokens.scope
			});
			console.log(`[trade-dashboard] tokenRefresh ms=${Date.now() - t3}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[trade-dashboard] tokenRefresh FAILED ms=${Date.now() - t3} err=${msg}`);
			// Return cached data immediately — do not block dashboard on failed refresh
			return {
				redirectTo: null,
				tradePartner: session.trade_partner,
				deals: [],
				warning: 'Syncing latest project data…',
				syncing: true
			};
		}
	}

	let deals: any[] = [];
	let warning = '';
	let syncing = false;

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

	// --- supabaseDeals / zohoProjects ---
	const t4 = Date.now();
	try {
		const allDeals = await withTimeout(
			getTradePartnerDeals(accessToken, tradePartnerZohoId, apiDomain),
			ZOHO_TIMEOUT_MS
		);
		console.log(`[trade-dashboard] zohoProjects ms=${Date.now() - t4}`);

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
			const t5 = Date.now();
			try {
				const hydrated = await fetchDealsByIds(
					accessToken,
					hydrateIds,
					includeDetailFields,
					apiDomain
				);
				console.log(`[trade-dashboard] supabaseDeals (hydrate) ms=${Date.now() - t5}`);
				const hydratedMap = new Map(hydrated.map((deal) => [deal.id, deal]));
				hydratedDeals = allDeals.map((deal) => hydratedMap.get(deal.id) || deal);
			} catch {
				console.warn(`[trade-dashboard] hydration failed ms=${Date.now() - t5} — using raw deals`);
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
		const is401 = message.includes('401') || message.toLowerCase().includes('invalid_oauthtoken');
		console.error(
			`[trade-dashboard] zohoProjects FAILED ms=${Date.now() - t4} 401=${is401} err=${message}`
		);
		// Circuit breaker: on 401 or timeout, return fast with syncing state
		if (is401 || message.includes('timed out')) {
			syncing = true;
			warning = 'Syncing latest project data…';
		} else {
			warning = 'Unable to load deals at this time. Please try again later or contact your admin.';
		}
	}

	console.log(`[trade-dashboard] total ms=${Date.now() - t0}`);

	return {
		redirectTo: null,
		tradePartner: session.trade_partner,
		deals,
		warning,
		syncing
	};
}
