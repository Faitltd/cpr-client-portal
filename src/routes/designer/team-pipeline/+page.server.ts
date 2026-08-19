import { getCrmDeals, requireStaffPage } from '$lib/server/designer';
import { getTeamPipeline, type PipelineRow } from '$lib/server/pipeline';
import type { DesignerDealSummary } from '$lib/types/designer';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	// Open to every internal staff role (designer / ops / finance) and admins.
	await requireStaffPage(cookies, '/designer/team-pipeline', ['designer', 'ops', 'finance']);

	let rows: PipelineRow[] = [];
	let warning = '';
	try {
		rows = await getTeamPipeline();
	} catch (err) {
		warning =
			err instanceof Error && err.message.includes('admin tokens')
				? 'Zoho is not connected yet — an admin needs to complete Zoho sign-in.'
				: 'Could not load the pipeline from Zoho. Try reloading in a moment.';
	}

	// Full deal records for the inline detail panel (contact, address, scope,
	// notes), limited to the deals shown so the payload stays small.
	let deals: DesignerDealSummary[] = [];
	if (rows.length > 0) {
		try {
			const rowIds = new Set(rows.map((r) => r.id));
			const all = await getCrmDeals();
			deals = all.filter((d) => rowIds.has(d.id));
		} catch {
			// Detail is best-effort; the list + KPIs still render without it.
		}
	}

	return { rows, deals, warning };
};
