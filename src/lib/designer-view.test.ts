import { describe, expect, it } from 'vitest';
import {
	filterDesignerDealsForView,
	getDesignerEmptyMessageForView,
	normalizeDesignerStageName
} from './designer-view';

const deals = [
	{ id: '1', stage: 'Quoted' },
	{ id: '2', stage: 'Project Created' },
	{ id: '3', stage: 'On Hold' },
	{ id: '4', stage: 'Completed' },
	{ id: '5', stage: null },
	{ id: '6', stage: { name: 'Design Review Needed (50%)' } }
];

describe('designer view helpers', () => {
	it('normalizes stage labels from strings and lookup objects', () => {
		expect(normalizeDesignerStageName(' Project Created (90%) ')).toBe('project created');
		expect(normalizeDesignerStageName({ name: 'On Hold' })).toBe('on hold');
		expect(normalizeDesignerStageName(null)).toBe('');
	});

	it('filters active view to active and stageless deals only', () => {
		expect(filterDesignerDealsForView(deals, 'active').map((deal) => deal.id)).toEqual([
			'1',
			'5',
			'6'
		]);
	});

	it('filters project created and on hold into their dedicated views', () => {
		expect(filterDesignerDealsForView(deals, 'project-created').map((deal) => deal.id)).toEqual([
			'2'
		]);
		expect(filterDesignerDealsForView(deals, 'on-hold').map((deal) => deal.id)).toEqual(['3']);
	});

	it('returns view-specific empty messages', () => {
		expect(getDesignerEmptyMessageForView('active')).toBe('No active deals found.');
		expect(getDesignerEmptyMessageForView('project-created')).toBe(
			'No deals currently in Project Created stage.'
		);
		expect(getDesignerEmptyMessageForView('on-hold')).toBe('No deals currently On Hold.');
	});
});
