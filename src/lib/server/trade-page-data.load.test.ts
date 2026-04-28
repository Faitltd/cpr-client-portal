import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getTradePartnerDeals: vi.fn(),
	isTradePortalVisibleStage: vi.fn(),
	normalizeDealRecord: vi.fn(),
	getTradeSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn(),
	refreshAccessToken: vi.fn(),
	zohoApiCall: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
	getTradePartnerDeals: mocks.getTradePartnerDeals,
	isTradePortalVisibleStage: mocks.isTradePortalVisibleStage,
	normalizeDealRecord: mocks.normalizeDealRecord
}));

vi.mock('$lib/server/db', () => ({
	getTradeSession: mocks.getTradeSession,
	getZohoTokens: mocks.getZohoTokens,
	upsertZohoTokens: mocks.upsertZohoTokens
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: mocks.refreshAccessToken,
	zohoApiCall: mocks.zohoApiCall
}));

import { loadTradePageContext } from './trade-page-data';

beforeEach(() => {
	vi.clearAllMocks();

	mocks.getTradeSession.mockResolvedValue({
		trade_partner: {
			zoho_trade_partner_id: 'tp-1',
			email: 'trade@example.com'
		}
	});
	mocks.getZohoTokens.mockResolvedValue({
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		expires_at: new Date(Date.now() + 60_000).toISOString(),
		api_domain: 'https://www.zohoapis.com',
		scope: 'scope'
	});
	mocks.normalizeDealRecord.mockImplementation((deal: any) => deal);
	mocks.isTradePortalVisibleStage.mockReturnValue(true);
});

describe('loadTradePageContext', () => {
	it('falls back to per-deal hydration when bulk hydration omits Garage_Code', async () => {
		mocks.getTradePartnerDeals.mockResolvedValue([
			{
				id: 'deal-1',
				Deal_Name: 'Kitchen Remodel',
				Stage: 'Project Created',
				File_Upload: [],
				Progress_Photos: []
			}
		]);

		mocks.zohoApiCall.mockImplementation(async (_token: string, path: string) => {
			if (path.startsWith('/Deals?ids=deal-1')) {
				return {
					data: [
						{
							id: 'deal-1',
							Deal_Name: 'Kitchen Remodel',
							Stage: 'Project Created',
							File_Upload: [],
							Progress_Photos: []
						}
					]
				};
			}

			if (path.startsWith('/Deals/deal-1?fields=')) {
				return {
					data: [
						{
							id: 'deal-1',
							Deal_Name: 'Kitchen Remodel',
							Stage: 'Project Created',
							Garage_Code: '1234',
							File_Upload: [],
							Progress_Photos: []
						}
					]
				};
			}

			throw new Error(`Unexpected path ${path}`);
		});

		const result = await loadTradePageContext('session-token', {
			includeDetailFields: true
		});

		expect(result.deals).toHaveLength(1);
		expect(result.deals[0].Garage_Code).toBe('1234');
		expect(mocks.zohoApiCall).toHaveBeenCalledWith(
			'access-token',
			expect.stringContaining('/Deals/deal-1?fields='),
			{},
			'https://www.zohoapis.com'
		);
	});
});
