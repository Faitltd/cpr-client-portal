import { describe, expect, it } from 'vitest';
import { summarizeDeal } from './designer';

describe('summarizeDeal', () => {
	it('renders ball-in-court fields from value-shaped Zoho objects', () => {
		const summary = summarizeDeal({
			id: 'deal-1',
			Deal_Name: 'Kitchen Remodel',
			Stage: 'Project Created',
			Ball_In_Court: { value: 'Designer' },
			Ball_In_Court_Note: { label: 'Awaiting selections' }
		});

		expect(summary?.ballInCourt).toBe('Designer');
		expect(summary?.ballInCourtNote).toBe('Awaiting selections');
	});
});
