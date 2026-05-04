import { beforeEach, describe, expect, it, vi } from 'vitest';

const zohoApiCallMock = vi.fn();
const loggerMock = {
	warn: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	debug: vi.fn()
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

	it('looks up deals via COQL on Deals_X_Trade_Partners and hydrates with Ball_In_Court fields', async () => {
		const { getTradePartnerDeals } = await loadAuthModule();
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path === '/coql') {
				return {
					data: [{ 'Portal_Deals.id': 'deal-1' }],
					info: { more_records: false }
				};
			}

			if (path.startsWith('/Deals?ids=')) {
				return {
					data: [{ id: 'deal-1', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' }]
				};
			}

			// Related-list discovery returns nothing — no fallback deals from that path.
			if (path.startsWith('/settings/related_lists')) {
				return { related_lists: [] };
			}

			// Any default related-list endpoint that happens to be probed: return empty.
			return { data: [] };
		});

		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		expect(deals).toHaveLength(1);
		expect(deals[0].id).toBe('deal-1');

		const coqlCall = zohoApiCallMock.mock.calls.find(([, path]) => path === '/coql');
		expect(coqlCall).toBeTruthy();
		const coqlBody = JSON.parse(String(coqlCall?.[2]?.body || '{}'));
		expect(String(coqlBody.select_query || '')).toContain('Deals_X_Trade_Partners');
		expect(String(coqlBody.select_query || '')).toContain("Portal_Trade_Partners = 'tp-1'");

		const idsPath = zohoApiCallMock.mock.calls.find(([, path]) =>
			String(path).startsWith('/Deals?ids=')
		)?.[1];
		expect(String(idsPath || '')).toContain('Ball_In_Court');
		expect(String(idsPath || '')).toContain('Ball_In_Court_Note');

		// Full-scan fallback should NOT run when search returned results.
		expect(
			zohoApiCallMock.mock.calls.some(([, path]) =>
				String(path).startsWith('/Deals?fields=')
			)
		).toBe(false);
	});

	it('merges COQL search results with related-list deals so a partial COQL response cannot hide deals', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path === '/coql') {
				return {
					data: [{ 'Portal_Deals.id': 'deal-1' }],
					info: { more_records: false }
				};
			}

			if (path.startsWith('/Deals?ids=')) {
				return {
					data: [{ id: 'deal-1', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' }]
				};
			}

			if (path === '/settings/related_lists?module=Trade_Partners') {
				return {
					related_lists: [{ api_name: 'Portal_Deals3', display_label: 'Deals' }]
				};
			}

			if (path.startsWith('/Trade_Partners/tp-1/Portal_Deals3')) {
				return {
					data: [
						{ id: 'deal-1', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' },
						{ id: 'deal-2', Deal_Name: 'Bath Remodel', Stage: 'Quoted' }
					]
				};
			}

			throw new Error(`Unexpected path ${path}`);
		});

		const { getTradePartnerDeals } = await loadAuthModule();
		const deals = await getTradePartnerDeals('access-token', 'tp-1', 'https://www.zohoapis.com');

		const ids = deals.map((deal) => deal.id).sort();
		expect(ids).toEqual(['deal-1', 'deal-2']);

		// Full-scan fallback should NOT run when the merged set is non-empty.
		expect(
			zohoApiCallMock.mock.calls.some(([, path]) =>
				String(path).startsWith('/Deals?fields=')
			)
		).toBe(false);
	});

	it('returns related-list deals when COQL search fails', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path === '/coql') {
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

	it('falls through to the full-scan fallback when both COQL search and related-list lookup return nothing', async () => {
		zohoApiCallMock.mockImplementation(async (_token: string, path: string) => {
			if (path === '/coql') {
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
