import type { DealFieldDescriptor, DesignerDealSummary } from '$lib/types/designer';

export const TRADE_DEALS_SYNC_POLL_MS = 2500;
export const TRADE_DASHBOARD_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

export type TradeDealsPayload = {
	deals?: unknown;
	designerDeals?: unknown;
	designerFieldDescriptors?: unknown;
	warning?: unknown;
	syncing?: unknown;
};

export function normalizeTradeDealsPayload(payload: TradeDealsPayload) {
	return {
		deals: Array.isArray(payload?.deals) ? payload.deals : [],
		designerDeals: Array.isArray(payload?.designerDeals)
			? (payload.designerDeals as DesignerDealSummary[])
			: [],
		designerFieldDescriptors: Array.isArray(payload?.designerFieldDescriptors)
			? (payload.designerFieldDescriptors as DealFieldDescriptor[])
			: [],
		warning: typeof payload?.warning === 'string' ? payload.warning : '',
		syncing: payload?.syncing === true
	};
}

export function getTradeDealsSyncPollDelay(syncing: boolean) {
	return syncing ? TRADE_DEALS_SYNC_POLL_MS : null;
}

export function getTradeDashboardCacheKey(tradePartnerEmail: string) {
	return `cpr:trade:dashboard:${tradePartnerEmail.trim().toLowerCase()}`;
}

export function createTradeDashboardCacheEntry(payload: TradeDealsPayload, now = Date.now()) {
	return {
		...normalizeTradeDealsPayload(payload),
		ts: now
	};
}

export function readTradeDashboardCache(raw: string | null | undefined, now = Date.now()) {
	if (typeof raw !== 'string' || raw.trim() === '') return null;

	try {
		const parsed = JSON.parse(raw);
		if (
			typeof parsed?.ts !== 'number' ||
			!Number.isFinite(parsed.ts) ||
			now - parsed.ts > TRADE_DASHBOARD_CACHE_MAX_AGE_MS
		) {
			return null;
		}

		const normalized = normalizeTradeDealsPayload(parsed);
		if (
			normalized.deals.length === 0 &&
			normalized.designerDeals.length === 0 &&
			normalized.warning === ''
		) {
			return null;
		}

		return normalized;
	} catch {
		return null;
	}
}
