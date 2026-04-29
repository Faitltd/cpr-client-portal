import { describe, expect, it } from 'vitest';
import {
	getTradeDealsSyncPollDelay,
	normalizeTradeDealsPayload,
	TRADE_DEALS_SYNC_POLL_MS
} from './trade-dashboard';

describe('trade dashboard helpers', () => {
	it('normalizes payload arrays and syncing state', () => {
		expect(
			normalizeTradeDealsPayload({
				deals: [{ id: '1' }],
				designerDeals: null,
				designerFieldDescriptors: 'bad',
				warning: 'warn',
				syncing: true
			})
		).toEqual({
			deals: [{ id: '1' }],
			designerDeals: [],
			designerFieldDescriptors: [],
			warning: 'warn',
			syncing: true
		});
	});

	it('polls only while syncing is still true', () => {
		expect(getTradeDealsSyncPollDelay(true)).toBe(TRADE_DEALS_SYNC_POLL_MS);
		expect(getTradeDealsSyncPollDelay(false)).toBeNull();
	});
});
