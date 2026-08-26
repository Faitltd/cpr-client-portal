import { getServiceSupabase } from './db';

/**
 * Admin Outreach tab data + actions.
 *
 * The `outreach` schema is not exposed to PostgREST; everything goes through
 * service_role-only SECURITY DEFINER RPCs (`outreach_*`). Keep every call here
 * behind the admin guard in the route.
 */
export type OutreachLead = {
	id: string;
	source_id: string;
	owner_name: string | null;
	address: string | null;
	score: number | null;
	score_reason: string | null;
	status: string;
	contacted_count: number;
	last_contacted_at: string | null;
	created_at: string;
};

export type OutreachRun = {
	started_at: string;
	finished_at: string | null;
	fetched: number;
	new_leads: number;
	qualified: number;
	needs_review: number;
	error: string | null;
};

export type OutreachCounts = { active: number; rejected: number; archived: number; all: number };

export type OutreachView = 'active' | 'rejected' | 'archived' | 'all';
export const OUTREACH_VIEWS: OutreachView[] = ['active', 'rejected', 'archived', 'all'];

export type OutreachDashboard = {
	leads: OutreachLead[];
	lastRun: OutreachRun | null;
	counts: OutreachCounts;
	view: OutreachView;
};

// Statuses an admin may set from the tab.
const SETTABLE_STATUSES = new Set(['qualified', 'needs_review', 'approved', 'rejected', 'archived']);

export function normalizeView(v: string | null | undefined): OutreachView {
	return (OUTREACH_VIEWS as string[]).includes(v ?? '') ? (v as OutreachView) : 'active';
}

export async function getOutreachDashboard(
	view: OutreachView = 'active',
	limit = 500
): Promise<OutreachDashboard> {
	const { data, error } = await getServiceSupabase().rpc('outreach_admin_dashboard', {
		p_limit: limit,
		p_view: view
	});
	if (error) throw new Error(`outreach dashboard query failed: ${error.message}`);

	const payload = (data ?? {}) as {
		leads?: OutreachLead[];
		last_run?: OutreachRun | null;
		counts?: OutreachCounts;
	};

	return {
		leads: payload.leads ?? [],
		lastRun: payload.last_run ?? null,
		counts: payload.counts ?? { active: 0, rejected: 0, archived: 0, all: 0 },
		view
	};
}

export async function markContacted(id: string): Promise<void> {
	const { error } = await getServiceSupabase().rpc('outreach_mark_contacted', { p_id: id });
	if (error) throw new Error(`mark contacted failed: ${error.message}`);
}

export async function unmarkContacted(id: string): Promise<void> {
	const { error } = await getServiceSupabase().rpc('outreach_unmark_contacted', { p_id: id });
	if (error) throw new Error(`unmark contacted failed: ${error.message}`);
}

export async function setLeadStatus(id: string, status: string): Promise<void> {
	if (!SETTABLE_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
	const { error } = await getServiceSupabase().rpc('outreach_update_lead', {
		p_id: id,
		p_patch: { status }
	});
	if (error) throw new Error(`set status failed: ${error.message}`);
}
