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
		expect(
			zohoApiCallMock.mock.calls.some(([, path]) =>
				String(path).startsWith('/Deals?fields=')
			)
		).toBe(false);
	});

	it('falls back to trade-partner related lists when field search fails, without scanning all deals', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path.startsWith('/Deals/search?criteria=')) {
				throw new Error('INVALID_QUERY');
			}

			if (path === '/settings/related_lists?module=Trade_Partners') {
				return {
					related_lists: [{ api_name: 'Portal_Deals3', display_label: 'Deals' }]
				};
			}

			if (path.startsWith('/Trade_Partners/tp-1/Portal_Deals3')) {
				return {
					data: [{ id: 'deal-2', Deal_Name: 'Bath Remodel', Stage: 'Quoted' }]
				};
			}

			throw new Error(`Unexpected path ${path}`);
		});

		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		expect(deals).toHaveLength(1);
		expect(deals[0].id).toBe('deal-2');
		expect(
			zohoApiCallMock.mock.calls.some(([, path]) =>
				String(path).startsWith('/Trade_Partners/tp-1/Portal_Deals3')
			)
		).toBe(true);
		expect(
			zohoApiCallMock.mock.calls.some(([, path]) =>
				String(path).startsWith('/Deals?fields=')
			)
		).toBe(false);
	});

	it('returns no deals when the trade partner id is missing', async () => {
		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', '', 'https://www.zohoapis.com');

		expect(deals).toEqual([]);
		expect(zohoApiCallMock).not.toHaveBeenCalled();
	});

	it('requests ball-in-court fields on the full-scan filtered fallback endpoint', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path.startsWith('/Deals/search?criteria=')) {
				throw new Error('INVALID_QUERY');
			}

			if (path === '/settings/related_lists?module=Trade_Partners') {
				return {
					related_lists: [{ api_name: 'Portal_Deals3', display_label: 'Deals' }]
				};
			}

			if (path.startsWith('/Trade_Partners/tp-1/Portal_Deals3')) {
				throw new Error('record not found');
			}

			if (path.startsWith('/Deals?fields=')) {
				return {
					data: [
						{
							id: 'deal-3',
							Deal_Name: 'Fallback Match',
							Portal_Trade_Partners: [{ id: 'tp-1' }]
						},
						{
							id: 'deal-4',
							Deal_Name: 'Different Trade Partner',
							Portal_Trade_Partners: [{ id: 'tp-2' }]
						}
					],
					info: { more_records: false }
				};
			}

			throw new Error(`Unexpected path ${path}`);
		});

		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		expect(deals).toHaveLength(1);
		expect(deals[0].id).toBe('deal-3');
		const fullScanPath = zohoApiCallMock.mock.calls.find(([, path]) =>
			String(path).startsWith('/Deals?fields=')
		)?.[1];
		expect(String(fullScanPath || '')).toContain('Ball_In_Court');
		expect(String(fullScanPath || '')).toContain('Ball_In_Court_Note');
	});
});
