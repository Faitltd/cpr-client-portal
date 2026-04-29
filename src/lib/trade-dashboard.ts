import type { DealFieldDescriptor, DesignerDealSummary } from '$lib/types/designer';

export const TRADE_DEALS_SYNC_POLL_MS = 2500;

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
