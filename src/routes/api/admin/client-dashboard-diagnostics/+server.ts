import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import {
	getClientByEmail,
	getCommsForDeal,
	getDailyLogsForDeal,
	getOpenFieldIssuesForDeal,
	getPendingApprovalsForDeal
} from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import type { RequestHandler } from './$types';

type ZohoDeal = {
	id?: string;
	Deal_Name?: string | null;
	Stage?: string | null;
	Modified_Time?: string | null;
	Created_Time?: string | null;
};

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const email = url.searchParams.get('email')?.trim().toLowerCase() || '';
	if (!email) {
		return json({ error: 'Missing email query parameter' }, { status: 400 });
	}

	try {
		const client = await getClientByEmail(email);
		if (!client) {
			return json({ error: 'Client not found', email }, { status: 404 });
		}

		const deals = (await getDealsForClient(client.zoho_contact_id, client.email)) as ZohoDeal[];
		const dealDiagnostics = await Promise.all(
			deals.map(async (deal) => {
				const dealId = String(deal?.id || '').trim();
				if (!dealId) {
					return {
						deal_id: '',
						deal_name: deal?.Deal_Name ?? '',
						stage: deal?.Stage ?? null,
						created_time: deal?.Created_Time ?? null,
						modified_time: deal?.Modified_Time ?? null,
						pending_count: 0,
						open_issue_count: 0,
						comms_count: 0,
						daily_log_count: 0,
						pending_items: [],
						recent_comms: [],
						recent_daily_logs: []
					};
				}

				const [pendingApprovals, openIssues, comms, dailyLogs] = await Promise.all([
					getPendingApprovalsForDeal(dealId, 'client'),
					getOpenFieldIssuesForDeal(dealId),
					getCommsForDeal(dealId),
					getDailyLogsForDeal(dealId)
				]);

				return {
					deal_id: dealId,
					deal_name: deal?.Deal_Name ?? '',
					stage: deal?.Stage ?? null,
					created_time: deal?.Created_Time ?? null,
					modified_time: deal?.Modified_Time ?? null,
					pending_count: pendingApprovals.length,
					open_issue_count: openIssues.length,
					comms_count: comms.length,
					daily_log_count: dailyLogs.length,
					pending_items: pendingApprovals.map((approval) => ({
						id: approval.id,
						title: approval.title,
						status: approval.status,
						assigned_to: approval.assigned_to,
						priority: approval.priority,
						due_date: approval.due_date,
						updated_at: approval.updated_at
					})),
					recent_comms: comms.slice(0, 5).map((entry) => ({
						id: entry.id,
						channel: entry.channel,
						subject: entry.subject,
						summary: entry.summary,
						created_at: entry.created_at
					})),
					recent_daily_logs: dailyLogs.slice(0, 5).map((entry) => ({
						id: entry.id,
						log_date: entry.log_date,
						work_completed: entry.work_completed,
						work_planned: entry.work_planned,
						created_at: entry.created_at
					}))
				};
			})
		);

		const totals = dealDiagnostics.reduce(
			(acc, deal) => {
				acc.deal_count += deal.deal_id ? 1 : 0;
				acc.pending_count += deal.pending_count;
				acc.open_issue_count += deal.open_issue_count;
				acc.comms_count += deal.comms_count;
				acc.daily_log_count += deal.daily_log_count;
				return acc;
			},
			{
				deal_count: 0,
				pending_count: 0,
				open_issue_count: 0,
				comms_count: 0,
				daily_log_count: 0
			}
		);

		return json({
			email,
			client,
			totals,
			deals: dealDiagnostics,
			dashboard_sources: {
				deal_resolution:
					'Client dashboard resolves deals via getDealsForClient(zoho_contact_id, email), matching the My Projects list.',
				pending_from_you:
					'Rows from approvals where deal_id matches a resolved deal, assigned_to = client, status = pending.',
				recent_activity:
					'Rows from comms_log and daily_logs where deal_id matches a resolved deal.',
				snapshot:
					'Pending approvals + comms + open field_issues where status != resolved.'
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[GET /api/admin/client-dashboard-diagnostics]', { email, error: err });
		return json({ error: message, email }, { status: 500 });
	}
};
