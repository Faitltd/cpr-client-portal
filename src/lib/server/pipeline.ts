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

export type PipelineTask = {
	id: string;
	subject: string;
	status: string | null;
	dueDate: string | null; // yyyy-MM-dd
	owner: string | null;
	closed: boolean;
	overdue: boolean;
};

/**
 * Fetch the Tasks related to a single deal (the same related list the nightly
 * rollup counts). Sorted overdue → open → completed. Returns [] when there are
 * none (Zoho answers 204).
 */
export async function getDealTasks(dealId: string): Promise<PipelineTask[]> {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw new Error('No Zoho admin tokens stored. Complete admin OAuth first.');
	}

	const response = await zohoApiCall(
		valid.accessToken,
		`/Deals/${encodeURIComponent(dealId)}/Tasks?fields=Subject,Status,Due_Date,Owner&per_page=200`,
		{ signal: AbortSignal.timeout(15000) },
		valid.apiDomain
	);

	const data = Array.isArray(response?.data) ? response.data : [];
	const today = new Date().toISOString().slice(0, 10);

	const tasks: PipelineTask[] = data.map((t: any): PipelineTask => {
		const status = typeof t?.Status === 'string' && t.Status.trim() ? t.Status : null;
		const dueDate =
			typeof t?.Due_Date === 'string' && t.Due_Date.trim() ? t.Due_Date.slice(0, 10) : null;
		const closed = status === 'Completed';
		return {
			id: String(t?.id ?? ''),
			subject: typeof t?.Subject === 'string' && t.Subject.trim() ? t.Subject : '(no subject)',
			status,
			dueDate,
			owner: t?.Owner && typeof t.Owner === 'object' ? (t.Owner.name ?? null) : null,
			closed,
			overdue: !closed && !!dueDate && dueDate < today
		};
	});

	// overdue (0) → open (1) → completed (2); then by due date ascending, nulls last.
	const rank = (t: PipelineTask) => (t.closed ? 2 : t.overdue ? 0 : 1);
	tasks.sort((a, b) => {
		const r = rank(a) - rank(b);
		if (r !== 0) return r;
		if (!a.dueDate && !b.dueDate) return 0;
		if (!a.dueDate) return 1;
		if (!b.dueDate) return -1;
		return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
	});

	return tasks;
}
