export type DesignerViewKey = 'active' | 'project-created' | 'on-hold';

export const DESIGNER_VIEW_TABS = [
	{
		key: 'active',
		label: 'Active Deals',
		href: '/designer',
		emptyMessage: 'No active deals found.'
	},
	{
		key: 'project-created',
		label: 'Project Created',
		href: '/designer/projects',
		emptyMessage: 'No deals currently in Project Created stage.'
	},
	{
		key: 'on-hold',
		label: 'On Hold',
		href: '/designer/on-hold',
		emptyMessage: 'No deals currently On Hold.'
	}
] as const satisfies ReadonlyArray<{
	key: DesignerViewKey;
	label: string;
	href: string;
	emptyMessage: string;
}>;

const ACTIVE_VIEW_EXCLUDED_STAGES: ReadonlySet<string> = new Set([
	'completed',
	'on hold',
	'lost',
	'project created'
]);

export function normalizeDesignerStageName(raw: unknown): string {
	let value: unknown = raw;
	if (value && typeof value === 'object') {
		value = (value as { name?: unknown; display_value?: unknown }).name ??
			(value as { display_value?: unknown }).display_value ??
			'';
	}
	if (typeof value !== 'string') return '';
	return value
		.trim()
		.toLowerCase()
		.replace(/\s*\(\s*\d+\s*%?\s*\)\s*/g, '')
		.trim();
}

export function isDesignerStageInView(stage: string, view: DesignerViewKey): boolean {
	if (view === 'project-created') return stage === 'project created';
	if (view === 'on-hold') return stage === 'on hold';
	return !ACTIVE_VIEW_EXCLUDED_STAGES.has(stage);
}

export function filterDesignerDealsForView<T extends { stage: unknown }>(
	deals: T[],
	view: DesignerViewKey
): T[] {
	return deals.filter((deal) => isDesignerStageInView(normalizeDesignerStageName(deal.stage), view));
}

export function getDesignerEmptyMessageForView(view: DesignerViewKey): string {
	return DESIGNER_VIEW_TABS.find((tab) => tab.key === view)?.emptyMessage ?? 'No deals found.';
}

export function groupDesignerDealsByView<T extends { stage: unknown }>(deals: T[]) {
	return DESIGNER_VIEW_TABS.map((tab) => ({
		...tab,
		deals: filterDesignerDealsForView(deals, tab.key)
	}));
}
