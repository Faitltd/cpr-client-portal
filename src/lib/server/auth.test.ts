import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	dev: false
}));

vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('$lib/server/logger', () => ({
	createLogger: () => ({
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn()
	})
}));

vi.mock('./zoho', () => ({
	zohoApiCall: vi.fn()
}));

import { zohoApiCall } from './zoho';
import {
	DEAL_FIELD_KEYS,
	getTradePartnerDeals,
	isTradePortalVisibleStage,
	normalizeDealRecord
} from './auth';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('trade deal field coverage', () => {
	it('includes ball-in-court fields in the trade deal fetch set', () => {
		expect(DEAL_FIELD_KEYS).toContain('Ball_In_Court');
		expect(DEAL_FIELD_KEYS).toContain('Ball_In_Court_Note');
	});

	it('requests ball-in-court fields when loading trade partner deals', async () => {
		vi.mocked(zohoApiCall).mockResolvedValue({
			data: [{ id: 'deal-1', Deal_Name: 'Project Alpha' }],
			info: { more_records: false }
		} as any);

		await getTradePartnerDeals('token', 'tp-1', 'https://www.zohoapis.com');

		expect(vi.mocked(zohoApiCall)).toHaveBeenCalledWith(
			'token',
			expect.stringContaining(
				`fields=${encodeURIComponent(DEAL_FIELD_KEYS.join(','))}`
			),
			{},
			'https://www.zohoapis.com'
		);
	});

	it('coerces ball-in-court fields to displayable strings', () => {
		expect(
			normalizeDealRecord({
				id: 'deal-1',
				Ball_In_Court: { name: 'Designer' },
				Ball_In_Court_Note: { display_value: 'Waiting on measurements' }
			})
		).toMatchObject({
			Ball_In_Court: 'Designer',
			Ball_In_Court_Note: 'Waiting on measurements'
		});
	});

	it('uses related-list fallback before scanning every deal', async () => {
		vi.mocked(zohoApiCall).mockImplementation(async (_token, endpoint) => {
			if (endpoint.startsWith('/Deals/search?criteria=')) {
				return { data: [], info: { more_records: false } } as any;
			}
			if (endpoint.startsWith('/settings/related_lists?module=Trade_Partners')) {
				return { related_lists: [{ api_name: 'Deals' }] } as any;
			}
			if (endpoint.startsWith('/Trade_Partners/tp-1/Deals?fields=')) {
				return { data: [{ id: 'deal-rl-1', Deal_Name: 'Related List Deal' }] } as any;
			}
			if (endpoint.startsWith('/Deals?fields=')) {
				throw new Error('full scan should not run when related-list lookup succeeds');
			}
			return { related_lists: [], data: [] } as any;
		});

		const result = await getTradePartnerDeals('token', 'tp-1', 'https://www.zohoapis.com');

		expect(result).toEqual([{ id: 'deal-rl-1', Deal_Name: 'Related List Deal' }]);
		expect(vi.mocked(zohoApiCall)).not.toHaveBeenCalledWith(
			'token',
			expect.stringMatching(/^\/Deals\?fields=/),
			{},
			'https://www.zohoapis.com'
		);
	});

	it('filters the full-scan fallback down to the current trade partner only', async () => {
		vi.mocked(zohoApiCall).mockImplementation(async (_token, endpoint) => {
			if (endpoint.startsWith('/Deals/search?criteria=')) {
				return { data: [], info: { more_records: false } } as any;
			}
			if (endpoint.startsWith('/settings/related_lists?module=')) {
				return { related_lists: [] } as any;
			}
			if (endpoint.startsWith('/Deals?fields=')) {
				return {
					data: [
						{
							id: 'deal-1',
							Deal_Name: 'Visible Deal',
							Portal_Trade_Partners: [{ id: 'tp-1', name: 'Partner One' }]
						},
						{
							id: 'deal-2',
							Deal_Name: 'Hidden Deal',
							Portal_Trade_Partners: [{ id: 'tp-2', name: 'Partner Two' }]
						}
					],
					info: { more_records: false }
				} as any;
			}
			return { data: [] } as any;
		});

		const result = await getTradePartnerDeals('token', 'tp-1', 'https://www.zohoapis.com');

		expect(result).toEqual([
			{
				id: 'deal-1',
				Deal_Name: 'Visible Deal',
				Portal_Trade_Partners: [{ id: 'tp-1', name: 'Partner One' }]
			}
		]);
	});

	it('falls back to the legacy full scan when scoped mapping returns no deals', async () => {
		vi.mocked(zohoApiCall).mockImplementation(async (_token, endpoint) => {
			if (endpoint.startsWith('/Deals/search?criteria=')) {
				return { data: [], info: { more_records: false } } as any;
			}
			if (endpoint.startsWith('/settings/related_lists?module=')) {
				return { related_lists: [] } as any;
			}
			if (endpoint.startsWith('/Deals?fields=')) {
				return {
					data: [{ id: 'deal-legacy-1', Deal_Name: 'Legacy Visible Deal' }],
					info: { more_records: false }
				} as any;
			}
			return { data: [] } as any;
		});

		const result = await getTradePartnerDeals('token', 'tp-1', 'https://www.zohoapis.com');

		expect(result).toEqual([{ id: 'deal-legacy-1', Deal_Name: 'Legacy Visible Deal' }]);
	});

	it('treats On Hold as visible in the trade partner portal', () => {
		expect(isTradePortalVisibleStage('On Hold')).toBe(true);
		expect(isTradePortalVisibleStage('On Hold (50%)')).toBe(true);
	});
});
