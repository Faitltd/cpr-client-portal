import { describe, expect, it } from 'vitest';
import {
	finalizeTradePageDeals,
	getTradeDealLabel,
	isTradeDealDisplayable,
	shouldHydrateTradeDeal
} from './trade-page-data';

describe('trade page deal helpers', () => {
	it('keeps displayable deals when useful labels are present', () => {
		const deals = [
			{ id: '1001', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' },
			{ id: '1002', Deal_Name: 'Deal 1002' }
		];

		expect(finalizeTradePageDeals(deals)).toEqual([
			{ id: '1001', Deal_Name: 'Kitchen Remodel', Stage: 'Project Created' }
		]);
	});

	it('falls back to id-backed deals so selectors still render when records are partial', () => {
		const deals = [{ id: '9988776655' }, { id: '1234567890', Deal_Name: 'Deal 7890' }];

		expect(finalizeTradePageDeals(deals)).toEqual([
			{ id: '9988776655', Deal_Name: 'Deal 776655' },
			{ id: '1234567890', Deal_Name: 'Deal 7890' }
		]);
	});

	it('marks partial deals for hydration before they are filtered away', () => {
		expect(shouldHydrateTradeDeal({ id: '1', Deal_Name: 'Deal 1' })).toBe(true);
		expect(shouldHydrateTradeDeal({ id: '2', Deal_Name: 'Bathroom', Stage: 'Project Created' })).toBe(
			false
		);
	});

	it('rehydrates dashboard deals when Garage_Code is missing from detail fields', () => {
		const partialDeal = {
			id: '4',
			Deal_Name: 'Main House',
			Stage: 'Project Created',
			File_Upload: [],
			Progress_Photos: []
		};

		expect(shouldHydrateTradeDeal(partialDeal, true)).toBe(true);
		expect(
			shouldHydrateTradeDeal(
				{
					...partialDeal,
					Garage_Code: '1234',
					Ball_In_Court: 'Designer',
					Ball_In_Court_Note: 'Awaiting selections'
				},
				true
			)
		).toBe(false);
	});

	it('treats null Garage_Code as missing for dashboard hydration', () => {
		expect(
			shouldHydrateTradeDeal(
				{
					id: '5',
					Deal_Name: 'Guest House',
					Stage: 'Project Created',
					Garage_Code: null,
					File_Upload: [],
					Progress_Photos: []
				},
				true
			)
		).toBe(true);
	});

	it('rehydrates dashboard deals when ball-in-court fields are missing from detail fields', () => {
		const partialDeal = {
			id: '6',
			Deal_Name: 'Pool House',
			Stage: 'Project Created',
			Garage_Code: '4321',
			File_Upload: [],
			Progress_Photos: []
		};

		expect(shouldHydrateTradeDeal(partialDeal, true)).toBe(true);
		expect(
			shouldHydrateTradeDeal(
				{
					...partialDeal,
					Ball_In_Court: 'Designer',
					Ball_In_Court_Note: 'Awaiting selections'
				},
				true
			)
		).toBe(false);
	});

	it('treats detail fields as displayable for dashboard pages', () => {
		const deal = { id: '3', Deal_Name: 'Deal 3', WiFi: 'CPR-Guest' };

		expect(isTradeDealDisplayable(deal, false)).toBe(false);
		expect(isTradeDealDisplayable(deal, true)).toBe(true);
		expect(getTradeDealLabel(deal)).toBe('Deal 3');
	});
});
