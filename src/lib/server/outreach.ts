import { getServiceSupabase } from './db';

/**
 * Read access to the `outreach` schema for the admin Outreach tab.
 *
 * The outreach schema is intentionally NOT exposed to PostgREST, and its client
 * roles are revoked. Reads go through `public.outreach_admin_dashboard()`, a
 * SECURITY DEFINER function whose EXECUTE privilege is granted only to
 * `service_role`. So only this server-side, service-role call can reach the
 * data — keep every use behind an admin guard.
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

export type OutreachDashboard = {
	leads: OutreachLead[];
	lastRun: OutreachRun | null;
	totalLeads: number;
};

export async function getOutreachDashboard(limit = 200): Promise<OutreachDashboard> {
	const { data, error } = await getServiceSupabase().rpc('outreach_admin_dashboard', {
		p_limit: limit
	});

	if (error) {
		throw new Error(`outreach dashboard query failed: ${error.message}`);
	}

	const payload = (data ?? {}) as {
		leads?: OutreachLead[];
		last_run?: OutreachRun | null;
		total?: number;
	};

	const leads = payload.leads ?? [];
	return {
		leads,
		lastRun: payload.last_run ?? null,
		totalLeads: payload.total ?? leads.length
	};
}
