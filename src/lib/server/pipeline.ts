/**
 * Team Pipeline data source.
 *
 * Reads the open sales pipeline straight from Zoho CRM via COQL, using the
 * rollup fields maintained nightly by the CRM function
 * `Pipeline_Contact_Refresh_Scheduled` (Last_Point_of_Contact,
 * Days_Since_Contact, Active_Task_Count, Overdue_Task_Count). This is the same
 * source of truth as the native CRM "Team Pipeline (Open)" list view and
 * "Sales Pipeline KPIs" dashboard, so the numbers always agree.
 *
 * Open pipeline = Stage NOT IN (Lost, Completed, Project Created).
 */
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';

export type PipelineRow = {
	id: string;
	name: string;
	stage: string | null;
	owner: string | null;
	/** yyyy-MM-dd of the most recent note / past meeting / call, or null. */
	lastContact: string | null;
	/** Whole days since lastContact (Zoho formula field), or null when none logged. */
	daysSince: number | null;
	activeTasks: number;
	overdueTasks: number;
};

const CLOSED_STAGES = ['Lost', 'Completed', 'Project Created'];

function toInt(value: unknown): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch the open pipeline, ordered oldest-contact-first so the most neglected
 * deals surface at the top (nulls — brand-new deals with nothing logged yet —
 * sort first). Returns [] on any Zoho error; the caller decides how to warn.
 */
export async function getTeamPipeline(): Promise<PipelineRow[]> {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw new Error('No Zoho admin tokens stored. Complete admin OAuth first.');
	}

	const stageList = CLOSED_STAGES.map((s) => `'${s}'`).join(',');
	const selectQuery =
		'select id, Deal_Name, Stage, Owner, Last_Point_of_Contact, Days_Since_Contact, ' +
		'Active_Task_Count, Overdue_Task_Count from Deals ' +
		`where Stage not in (${stageList}) ` +
		'order by Last_Point_of_Contact asc limit 200';

	const response = await zohoApiCall(
		valid.accessToken,
		'/coql',
		{
			method: 'POST',
			body: JSON.stringify({ select_query: selectQuery }),
			signal: AbortSignal.timeout(15000)
		},
		valid.apiDomain
	);

	// COQL returns 204 (→ empty/null body) when nothing matches.
	const data = Array.isArray(response?.data) ? response.data : [];

	return data.map((raw: any): PipelineRow => {
		const owner = raw?.Owner;
		return {
			id: String(raw?.id ?? ''),
			name: typeof raw?.Deal_Name === 'string' ? raw.Deal_Name : '(unnamed deal)',
			stage: typeof raw?.Stage === 'string' && raw.Stage.trim() ? raw.Stage : null,
			owner: owner && typeof owner === 'object' ? (owner.name ?? null) : null,
			lastContact:
				typeof raw?.Last_Point_of_Contact === 'string' && raw.Last_Point_of_Contact.trim()
					? raw.Last_Point_of_Contact
					: null,
			daysSince:
				raw?.Days_Since_Contact === null || raw?.Days_Since_Contact === undefined
					? null
					: toInt(raw.Days_Since_Contact),
			activeTasks: toInt(raw?.Active_Task_Count),
			overdueTasks: toInt(raw?.Overdue_Task_Count)
		};
	});
}
