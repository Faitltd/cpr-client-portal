import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const query = {
		select: vi.fn(),
		eq: vi.fn(),
		not: vi.fn(),
		order: vi.fn()
	};

	query.select.mockReturnValue(query);
	query.eq.mockReturnValue(query);
	query.not.mockReturnValue(query);

	return {
		getTradeSession: vi.fn(),
		getZohoTokens: vi.fn(),
		upsertZohoTokens: vi.fn(),
		getTradePartnerDeals: vi.fn(),
		refreshAccessToken: vi.fn(),
		supabaseFrom: vi.fn(),
		supabaseQuery: query
	};
});

vi.mock('$lib/server/db', () => ({
	getTradeSession: mocks.getTradeSession,
	getZohoTokens: mocks.getZohoTokens,
	upsertZohoTokens: mocks.upsertZohoTokens,
	supabase: {
		from: mocks.supabaseFrom
	}
}));

vi.mock('$lib/server/auth', () => ({
	getTradePartnerDeals: mocks.getTradePartnerDeals
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: mocks.refreshAccessToken
}));

import { GET } from './+server';

function makeCookies(values: Record<string, string | undefined>) {
	return {
		get(name: string) {
			return values[name];
		}
	};
}

describe('GET /api/trade/deals/:id/scope', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mocks.getTradeSession.mockResolvedValue({
			trade_partner: {
				zoho_trade_partner_id: 'tp-1'
			}
		});
		mocks.getZohoTokens.mockResolvedValue({
			user_id: 'user-1',
			access_token: 'access-token',
			refresh_token: 'refresh-token',
			expires_at: new Date(Date.now() + 60_000).toISOString(),
			scope: 'scope'
		});
		mocks.getTradePartnerDeals.mockResolvedValue([{ id: 'deal-1' }]);
		mocks.supabaseFrom.mockReturnValue(mocks.supabaseQuery);
	});

	it('returns ordered non-empty scope document links for an accessible deal', async () => {
		mocks.supabaseQuery.order.mockResolvedValue({
			data: [
				{ trade: 'Electrical', document_url: 'https://example.com/electrical.pdf' },
				{ trade: 'Plumbing', document_url: 'https://example.com/plumbing.pdf' }
			],
			error: null
		});

		const response = await GET({
			cookies: makeCookies({ trade_session: 'valid-session' }),
			params: { id: 'deal-1' }
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: [
				{ label: 'Electrical', url: 'https://example.com/electrical.pdf' },
				{ label: 'Plumbing', url: 'https://example.com/plumbing.pdf' }
			]
		});
		expect(mocks.supabaseFrom).toHaveBeenCalledWith('scope_tasks');
		expect(mocks.supabaseQuery.eq).toHaveBeenCalledWith('deal_id', 'deal-1');
		expect(mocks.supabaseQuery.not).toHaveBeenNthCalledWith(1, 'document_url', 'is', null);
		expect(mocks.supabaseQuery.not).toHaveBeenNthCalledWith(2, 'document_url', 'eq', '');
		expect(mocks.supabaseQuery.order).toHaveBeenCalledWith('trade', { ascending: true });
	});

	it('returns an empty data array when the deal has no scope links', async () => {
		mocks.supabaseQuery.order.mockResolvedValue({
			data: [],
			error: null
		});

		const response = await GET({
			cookies: makeCookies({ trade_session: 'valid-session' }),
			params: { id: 'deal-1' }
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: [] });
	});
});
