import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase, listClients } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const [
			clients,
			pendingApprovalsRes,
			openIssuesRes,
			recentLogsRes,
			recentCommsRes
		] = await Promise.all([
			listClients(),
			supabase
				.from('approvals')
				.select('id', { count: 'exact', head: true })
				.eq('status', 'pending'),
			supabase
				.from('field_issues')
				.select('id', { count: 'exact', head: true })
				.neq('status', 'resolved'),
			supabase
				.from('daily_logs')
				.select('id, deal_id, trade_partner_id, log_date, hours_worked, work_completed, created_at')
				.order('log_date', { ascending: false })
				.limit(5),
			supabase
				.from('comms_log')
				.select('id, deal_id, direction, channel, subject, created_at')
				.order('created_at', { ascending: false })
				.limit(5)
		]);

		return json({
			data: {
				active_projects: clients.length,
				pending_approvals: pendingApprovalsRes.count ?? 0,
				open_issues: openIssuesRes.count ?? 0,
				recent_logs: recentLogsRes.data ?? [],
				recent_comms: recentCommsRes.data ?? []
			}
		});
	} catch (err) {
		console.error('GET /api/admin/dashboard error:', err);
		const error = err instanceof Error ? err.message : 'Failed to load dashboard';
		return json({ error }, { status: 500 });
	}
};
