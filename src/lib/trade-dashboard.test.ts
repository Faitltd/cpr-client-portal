import { describe, expect, it } from 'vitest';
import {
	createTradeDashboardCacheEntry,
	getTradeDealsSyncPollDelay,
	getTradeDashboardCacheKey,
	normalizeTradeDealsPayload,
	readTradeDashboardCache,
	TRADE_DASHBOARD_CACHE_MAX_AGE_MS,
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

	it('builds a stable dashboard cache key from the trade partner email', () => {
		expect(getTradeDashboardCacheKey('  Trade@Example.com  ')).toBe(
			'cpr:trade:dashboard:trade@example.com'
		);
	});

	it('reads a fresh cached dashboard payload', () => {
		const cached = createTradeDashboardCacheEntry(
			{
				deals: [{ id: '1' }],
				designerDeals: [{ id: 'd1' }],
				designerFieldDescriptors: [{ key: 'Deal_Name' }],
				warning: '',
				syncing: false
			},
			1_000
		);

		expect(readTradeDashboardCache(JSON.stringify(cached), 1_500)).toEqual({
			deals: [{ id: '1' }],
			designerDeals: [{ id: 'd1' }],
			designerFieldDescriptors: [{ key: 'Deal_Name' }],
			warning: '',
			syncing: false
		});
	});

	it('ignores expired dashboard cache entries', () => {
		const cached = createTradeDashboardCacheEntry(
			{
				deals: [{ id: '1' }]
			},
			1_000
		);

		expect(
			readTradeDashboardCache(
				JSON.stringify(cached),
				1_000 + TRADE_DASHBOARD_CACHE_MAX_AGE_MS + 1
			)
		).toBeNull();
	});
});
