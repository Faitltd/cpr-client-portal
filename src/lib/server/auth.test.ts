import { beforeEach, describe, expect, it, vi } from 'vitest';

const zohoApiCallMock = vi.fn();
const loggerMock = {
	warn: vi.fn(),
	error: vi.fn()
};

vi.mock('$app/environment', () => ({
	dev: false
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		PORTAL_DEV_SHOW_ALL: 'false',
		ZOHO_TRADE_PARTNERS_MODULE: 'Trade_Partners',
		ZOHO_TRADE_PARTNER_RELATED_LIST: 'Portal_Deals3'
	}
}));

vi.mock('./zoho', () => ({
	zohoApiCall: (...args: unknown[]) => zohoApiCallMock(...args)
}));

vi.mock('$lib/server/logger', () => ({
	createLogger: () => loggerMock
}));

async function loadAuthModule() {
	vi.resetModules();
	return import('./auth');
}

describe('getTradePartnerDeals', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('requests ball-in-court fields on the targeted deals search endpoint', async () => {
		zohoApiCallMock.mockResolvedValueOnce({
			data: [{ id: 'deal-1', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' }],
			info: { more_records: false }
		});

		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		expect(deals).toHaveLength(1);
		expect(deals[0].id).toBe('deal-1');
		expect(String(zohoApiCallMock.mock.calls[0]?.[1] || '')).toContain('/Deals/search?criteria=');
		expect(String(zohoApiCallMock.mock.calls[0]?.[1] || '')).toContain('Ball_In_Court');
		expect(String(zohoApiCallMock.mock.calls[0]?.[1] || '')).toContain('Ball_In_Court_Note');
	});

	it('requests ball-in-court fields on the full-scan fallback endpoint', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path.startsWith('/Deals/search?criteria=')) {
				throw new Error('INVALID_QUERY');
			}

			if (path.startsWith('/Deals?fields=')) {
				return {
					data: [{ id: 'deal-2', Deal_Name: 'Bath Remodel', Stage: 'Quoted' }],
					info: { more_records: false }
				};
			}

			throw new Error(`Unexpected path ${path}`);
		});

		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		expect(deals).toHaveLength(1);
		expect(deals[0].id).toBe('deal-2');
		const fullScanPath = zohoApiCallMock.mock.calls.find(([, path]) =>
			String(path).startsWith('/Deals?fields=')
		)?.[1];
		expect(String(fullScanPath || '')).toContain('Ball_In_Court');
		expect(String(fullScanPath || '')).toContain('Ball_In_Court_Note');
	});
});
