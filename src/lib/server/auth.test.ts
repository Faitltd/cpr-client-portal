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
import { DEAL_FIELD_KEYS, getTradePartnerDeals, normalizeDealRecord } from './auth';

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
});
