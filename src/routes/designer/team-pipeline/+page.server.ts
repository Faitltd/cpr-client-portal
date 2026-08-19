import { requireStaffPage } from '$lib/server/designer';
import { getTeamPipeline, type PipelineRow } from '$lib/server/pipeline';
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

	return { rows, warning };
};
