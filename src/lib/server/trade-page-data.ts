import {
	getTradePartnerDeals,
	isTradePortalVisibleStage,
	normalizeDealRecord
} from '$lib/server/auth';
import { DESIGNER_FETCH_FIELD_KEYS } from '$lib/types/designer';
import {
	getTradeSession,
	getZohoTokens,
	type TradePartner,
	upsertZohoTokens
} from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { buildCacheKey, getCache, setCache } from '$lib/server/api-cache';

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

const DETAIL_DEAL_FIELDS = Array.from(new Set(DESIGNER_FETCH_FIELD_KEYS));

const ZOHO_TIMEOUT_MS = 5000;
// Supabase cache TTL: serve stale after 2 min, expire after 1 year
const DEALS_CACHE_STALE_SEC = 120;

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
	return Array.from(
		new Set([...BASE_DEAL_FIELDS, ...(includeDetailFields ? DETAIL_DEAL_FIELDS : [])])
	).join(',');
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
	return Boolean(deal?.Garage_Code || deal?.WiFi || deal?.Refined_Scope);
}

function hasGarageCodeValue(value: unknown) {
	return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function hasTradeDetailValue(value: unknown) {
	if (typeof value === 'string') return value.trim().length > 0;
	return value !== null && value !== undefined;
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

/**
 * P2: Tightened hydration check.
 * Only re-fetch if the deal is truly incomplete — missing Stage, no displayable
 * name AND no address. We no longer trigger hydration just because
 * File_Upload / Progress_Photos are undefined; those fields are often blank.
 */
export function shouldHydrateTradeDeal(deal: any, includeDetailFields = false) {
	const dealId = String(deal?.id || '').trim();
	if (!dealId) return false;
	// Always hydrate if Stage is missing — we need it to filter visibility
	if (!deal?.Stage) return true;
	// Hydrate if the deal isn't displayable yet
	if (!isTradeDealDisplayable(deal, includeDetailFields)) return true;
	// For dashboard detail cards, the trade path needs the same ball-in-court
	// fields the designer dashboard already relies on.
	if (includeDetailFields) {
		if (!hasGarageCodeValue(deal?.Garage_Code)) return true;
		if (!hasTradeDetailValue(deal?.Ball_In_Court)) return true;
		if (!hasTradeDetailValue(deal?.Ball_In_Court_Note)) return true;
	}
	return false;
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

/**
 * P1: Parallelized fallback fetches.
 * Previously iterated serially (N × 2.5s). Now fans out with Promise.allSettled
 * so all per-deal fallback calls race in parallel (1 × timeout ceiling).
 */
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

		// Bulk fetch first
		const bulkResponse = await withTimeout(
			zohoApiCall(
				accessToken,
				`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields)}`,
				{},
				apiDomain
			),
			ZOHO_TIMEOUT_MS
		);
		const bulkDeals = (bulkResponse.data || []).map(normalizeDealRecord);
		const dealsById = new Map<string, any>(
			bulkDeals
				.map((deal: any) => {
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

		// P1: fan out all fallback fetches in parallel
		if (needsFallbackIds.length > 0) {
			const fallbackResults = await Promise.allSettled(
				needsFallbackIds.map((id) =>
					withTimeout(
						zohoApiCall(
							accessToken,
							`/Deals/${id}?fields=${encodeURIComponent(fields)}`,
							{},
							apiDomain
						),
						ZOHO_TIMEOUT_MS
					).then((res) => ({ id, deal: res.data?.[0] }))
				)
			);
			for (const result of fallbackResults) {
				if (result.status === 'fulfilled' && result.value.deal) {
					dealsById.set(String(result.value.id), normalizeDealRecord(result.value.deal));
				}
			}
		}

		for (const id of chunk) {
			const deal = dealsById.get(String(id));
			if (deal) results.push(deal);
		}
	}

	return results;
}

/**
 * P3: Supabase-backed stale-while-revalidate cache for the deals list.
 * On a cache hit (even stale), returns immediately and fires a background refresh.
 * On a cache miss, fetches live and writes the result before returning.
 */
async function fetchAndCacheDeals(
	accessToken: string,
	tradePartnerZohoId: string,
	includeDetailFields: boolean,
	apiDomain: string | undefined
): Promise<{ deals: any[]; syncing: boolean; warning: string }> {
	const cacheKey = buildCacheKey('trade:deals', tradePartnerZohoId, includeDetailFields ? 'detail' : 'base');

	// Try cache first
	const cached = await getCache(cacheKey);
	if (cached) {
		if (!cached.isStale) {
			// Fresh — return immediately, no background fetch needed
			return { deals: cached.data.deals ?? [], syncing: false, warning: cached.data.warning ?? '' };
		}
		// Stale — return cached data immediately, revalidate in background
		refreshDealsCache(cacheKey, accessToken, tradePartnerZohoId, includeDetailFields, apiDomain).catch(() => {});
		return { deals: cached.data.deals ?? [], syncing: true, warning: '' };
	}

	// Cache miss — fetch live
	return refreshDealsCache(cacheKey, accessToken, tradePartnerZohoId, includeDetailFields, apiDomain);
}

async function refreshDealsCache(
	cacheKey: string,
	accessToken: string,
	tradePartnerZohoId: string,
	includeDetailFields: boolean,
	apiDomain: string | undefined
): Promise<{ deals: any[]; syncing: boolean; warning: string }> {
	let deals: any[] = [];
	let warning = '';

	try {
		const allDeals = await withTimeout(
			getTradePartnerDeals(accessToken, tradePartnerZohoId, apiDomain),
			ZOHO_TIMEOUT_MS
		);

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
				const hydrated = await fetchDealsByIds(accessToken, hydrateIds, includeDetailFields, apiDomain);
				const hydratedMap = new Map(hydrated.map((deal) => [deal.id, deal]));
				hydratedDeals = allDeals.map((deal) => hydratedMap.get(deal.id) || deal);
			} catch {
				// Non-fatal — use raw deals
			}
		}

		const visibleDeals = hydratedDeals.filter((deal) => isTradePortalVisibleStage(deal?.Stage));
		deals = finalizeTradePageDeals(visibleDeals, includeDetailFields);

		if (deals.length === 0) {
			warning = 'No deals found in Quoted or Project Created. Please try again later or contact your admin.';
		}

		// Write to cache (non-blocking fire-and-forget on errors)
		setCache(cacheKey, { deals, warning }, { staleSec: DEALS_CACHE_STALE_SEC }).catch(() => {});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[trade-page-data] refreshDealsCache failed: ${message}`);
		warning = 'Unable to load deals at this time. Please try again later or contact your admin.';
	}

	return { deals, syncing: false, warning };
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

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return { redirectTo: '/auth/trade', tradePartner: null, deals: [], warning: '' };
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		return { redirectTo: '/auth/login', tradePartner: null, deals: [], warning: '' };
	}

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[trade-page-data] tokenRefresh FAILED: ${msg}`);
			return {
				redirectTo: null,
				tradePartner: session.trade_partner,
				deals: [],
				warning: 'Syncing latest project data…',
				syncing: true
			};
		}
	}

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

	let deals: any[] = [];
	let warning = '';
	let syncing = false;

	try {
		const result = await fetchAndCacheDeals(accessToken, tradePartnerZohoId, includeDetailFields, apiDomain);
		deals = result.deals;
		warning = result.warning;
		syncing = result.syncing;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const is401 = message.includes('401') || message.toLowerCase().includes('invalid_oauthtoken');
		console.error(`[trade-page-data] loadTradePageContext FAILED 401=${is401}: ${message}`);
		syncing = is401 || message.includes('timed out');
		warning = syncing
			? 'Syncing latest project data…'
			: 'Unable to load deals at this time. Please try again later or contact your admin.';
	}

	console.log(`[trade-page-data] total ms=${Date.now() - t0}`);

	return {
		redirectTo: null,
		tradePartner: session.trade_partner,
		deals,
		warning,
		syncing
	};
}
