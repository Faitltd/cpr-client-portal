import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTradePageContext } from './trade-page-data';

vi.mock('$lib/server/db', () => ({
	getTradeSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn()
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: vi.fn(),
	zohoApiCall: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
	getTradePartnerDeals: vi.fn(),
	isTradePortalVisibleStage: vi.fn(() => true),
	normalizeDealRecord: vi.fn((d) => d)
}));

vi.mock('$lib/server/api-cache', () => ({
	buildCacheKey: (...parts: string[]) => parts.filter(Boolean).join(':'),
	getCache: vi.fn(),
	setCache: vi.fn()
}));

import * as auth from '$lib/server/auth';
import * as cache from '$lib/server/api-cache';
import * as db from '$lib/server/db';

const VALID_SESSION = {
	trade_partner: { zoho_trade_partner_id: 'tp-123', id: 'p-1' }
};

const VALID_TOKENS = {
	access_token: 'at-valid',
	refresh_token: 'rt-valid',
	expires_at: new Date(Date.now() + 60_000).toISOString(),
	user_id: 'u1',
	scope: 'ZohoCRM.modules.ALL',
	api_domain: 'https://www.zohoapis.com'
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(cache.setCache).mockResolvedValue(undefined);
});

describe('loadTradePageContext cache behavior', () => {
	it('bypasses fresh empty cache entries and fetches live trade deals', async () => {
		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(cache.getCache).mockResolvedValue({
			data: {
				deals: [],
				warning: 'No deals found for your account. Please try again later or contact your admin.'
			},
			isStale: false
		} as any);
		vi.mocked(auth.getTradePartnerDeals).mockResolvedValue([
			{
				id: 'deal-1',
				Deal_Name: 'Kitchen Remodel',
				Stage: 'Project Started',
				Address: '123 Main'
			}
		] as any);

		const result = await loadTradePageContext('valid-token');

		expect(result.redirectTo).toBeNull();
		expect(result.deals).toEqual([
			{
				id: 'deal-1',
				Deal_Name: 'Kitchen Remodel',
				Stage: 'Project Started',
				Address: '123 Main'
			}
		]);
		expect(result.warning).toBe('');
		expect(result.syncing).toBe(false);
		expect(vi.mocked(auth.getTradePartnerDeals)).toHaveBeenCalledTimes(1);
	});
});
