import { redirect } from '@sveltejs/kit';
import { getDesignerDashboardContext, requireStaffPage } from '$lib/server/designer';
import { getDealTaskSummaries, type DealTaskSummary } from '$lib/server/projects';
import type { PageServerLoad } from './$types';

type DealTasks = {
	id: string;
	name: string;
	stage: string | null;
	contactName: string | null;
	ballInCourt: string | null;
	taskCount: number;
	completedCount: number;
	tasks: { id: string; name: string; status: string | null; completed: boolean }[];
};

export const load: PageServerLoad = async ({ cookies }) => {
	await requireStaffPage(cookies, '/designer/tasks', ['designer', 'ops']);

	const context = await getDesignerDashboardContext(cookies.get('portal_session'));
	if (!context) {
		throw redirect(302, '/auth/portal?next=/designer/tasks');
	}

	let warning = context.warning;
	let summaries = new Map<string, DealTaskSummary | null>();
	try {
		summaries = await getDealTaskSummaries(
			context.deals.map((deal) => deal.id),
			{ concurrency: 3, previewLimit: 50 }
		);
	} catch (err) {
		warning = warning || (err instanceof Error ? err.message : 'Unable to load tasks.');
	}

	const dealsWithTasks: DealTasks[] = context.deals
		.map((deal) => {
			const summary = summaries.get(deal.id) ?? null;
			return {
				id: deal.id,
				name: deal.name,
				stage: deal.stage,
				contactName: deal.contactName,
				ballInCourt: deal.ballInCourt,
				taskCount: summary?.taskCount ?? 0,
				completedCount: summary?.completedCount ?? 0,
				tasks: summary?.preview ?? []
			};
		})
		.filter((deal) => deal.taskCount > 0)
		.sort((a, b) => b.taskCount - b.completedCount - (a.taskCount - a.completedCount));

	return { dealsWithTasks, warning };
};
