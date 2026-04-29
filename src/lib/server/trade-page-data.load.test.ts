import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadTradePageContext } from './trade-page-data';

// --- Module mocks ---
vi.mock('$lib/server/db', () => ({
	getTradeSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn()
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: vi.fn(),
	zohoApiCall: vi.fn()
}));

vi.mock('$lib/server/api-cache', () => ({
	buildCacheKey: vi.fn((...parts: string[]) => parts.join(':')),
	getCache: vi.fn().mockResolvedValue(null),
	setCache: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/auth', () => ({
	getTradePartnerDeals: vi.fn(),
	isTradePortalVisibleStage: vi.fn(() => true),
	normalizeDealRecord: vi.fn((d) => d)
}));

import * as db from '$lib/server/db';
import * as zoho from '$lib/server/zoho';
import * as auth from '$lib/server/auth';

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
});

describe('loadTradePageContext', () => {
	it('redirects to /auth/trade when no session token', async () => {
		const result = await loadTradePageContext(null);
		expect(result.redirectTo).toBe('/auth/trade');
		expect(result.deals).toEqual([]);
	});

	it('returns cached empty deals fast when Zoho throws 401', async () => {
		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(auth.getTradePartnerDeals).mockRejectedValue(
			new Error('Request failed with status 401 INVALID_OAUTHTOKEN')
		);

		const t0 = Date.now();
		const result = await loadTradePageContext('valid-token');
		const elapsed = Date.now() - t0;

		expect(result.redirectTo).toBeNull();
		expect(result.deals).toEqual([]);
		expect(result.syncing).toBe(true);
		expect(result.warning).toMatch(/syncing/i);
		expect(elapsed).toBeLessThan(1000);
	});

	it('returns cached deals fast when Zoho times out', async () => {
		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(auth.getTradePartnerDeals).mockRejectedValue(
			new Error('Zoho call timed out after 2500ms')
		);

		const result = await loadTradePageContext('valid-token');
		expect(result.deals).toEqual([]);
		expect(result.syncing).toBe(true);
	});

	it('does not retry portal discovery after 401 — called exactly once', async () => {
		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(auth.getTradePartnerDeals).mockRejectedValue(
			new Error('401 INVALID_OAUTHTOKEN')
		);

		await loadTradePageContext('valid-token');
		expect(vi.mocked(auth.getTradePartnerDeals)).toHaveBeenCalledTimes(1);
	});

	it('returns Supabase deals without blocking on Zoho when token valid and deals cached', async () => {
		const fakeDeal = { id: 'd1', Stage: 'Quoted', Deal_Name: 'Test Project', Address: '123 Main' };
		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(auth.getTradePartnerDeals).mockResolvedValue([fakeDeal] as any);
		vi.mocked(auth.isTradePortalVisibleStage).mockReturnValue(true);

		const result = await loadTradePageContext('valid-token', { includeDetailFields: true });
		expect(result.deals.length).toBeGreaterThan(0);
		expect(result.syncing).toBeFalsy();
	});

	it('preserves all trade-partner deals for the designer view while filtering the main trade list', async () => {
		const quotedDeal = { id: 'd1', Stage: 'Quoted', Deal_Name: 'Quoted Deal', Address: '123 Main' };
		const contractDeal = {
			id: 'd2',
			Stage: 'Contract Needed',
			Deal_Name: 'Contract Deal',
			Address: '456 Oak'
		};

		vi.mocked(db.getTradeSession).mockResolvedValue(VALID_SESSION as any);
		vi.mocked(db.getZohoTokens).mockResolvedValue(VALID_TOKENS as any);
		vi.mocked(auth.getTradePartnerDeals).mockResolvedValue([quotedDeal, contractDeal] as any);
		vi.mocked(auth.isTradePortalVisibleStage).mockImplementation((stage) => stage === 'Quoted');

		const result = await loadTradePageContext('valid-token', { includeDetailFields: true });

		expect(result.deals.map((deal) => deal.id)).toEqual(['d1']);
		expect(result.designerDeals?.map((deal) => deal.id)).toEqual(['d1', 'd2']);
	});
});
