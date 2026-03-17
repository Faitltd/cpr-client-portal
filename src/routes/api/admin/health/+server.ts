import { json } from '@sveltejs/kit';
import { isPortalActiveStage } from '$lib/server/auth';
import { isValidAdminSession } from '$lib/server/admin';
import {
	getCommsForDeal,
	getOpenFieldIssuesForDeal,
	getPendingApprovalsForDeal,
	getZohoTokens,
	listClients,
	upsertZohoTokens
} from '$lib/server/db';
import { getProjectTasks, parseZohoProjectIds } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const DEAL_FIELDS = ['Deal_Name', 'Stage', 'Contact_Name', 'Project_ID', 'Deal_Amount'].join(',');
const DEAL_LIMIT = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type HealthStatus = 'healthy' | 'warning' | 'critical';

interface HealthSignals {
	schedule: number;
	budget: number;
	issues: number;
	decisions: number;
	comms: number;
}

interface HealthProject {
	deal_id: string;
	project_name: string;
	score: number;
	signals: HealthSignals;
	status: HealthStatus;
}

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

function getLookupId(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const candidate = record.id ?? record.value ?? null;
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function getLookupName(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const candidate = record.name ?? record.display_value ?? record.displayValue ?? null;
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function getDealName(deal: any) {
	if (typeof deal?.Deal_Name === 'string' && deal.Deal_Name.trim()) {
		return deal.Deal_Name.trim();
	}
	return getLookupName(deal?.Deal_Name) ?? 'Untitled Project';
}

function clampScore(value: number) {
	if (!Number.isFinite(value)) return 50;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function getStatusFromScore(score: number): HealthStatus {
	if (score >= 70) return 'healthy';
	if (score >= 50) return 'warning';
	return 'critical';
}

function getDayDiff(from: string | null | undefined, now = Date.now()) {
	if (!from) return null;
	const date = new Date(from);
	if (Number.isNaN(date.getTime())) return null;
	return Math.max(0, Math.floor((now - date.getTime()) / MS_PER_DAY));
}

function isTaskCompleted(task: any) {
	const statusCandidate = [task?.status, task?.task_status, task?.status_name].find(
		(value) => typeof value === 'string' && value.trim()
	);
	const status = typeof statusCandidate === 'string' ? statusCandidate.trim().toLowerCase() : '';

	if (
		status.includes('complete') ||
		status.includes('closed') ||
		status.includes('done') ||
		status.includes('resolved') ||
		status.includes('finished')
	) {
		return true;
	}

	const percentCandidate = [task?.percent_complete, task?.percent_completed, task?.completed_percent].find(
		(value) => value !== null && value !== undefined
	);
	if (typeof percentCandidate === 'number' && percentCandidate >= 100) return true;
	if (typeof percentCandidate === 'string') {
		const parsed = Number(percentCandidate.replace('%', '').trim());
		if (Number.isFinite(parsed) && parsed >= 100) return true;
	}

	return task?.completed === true || task?.Completed === true;
}

function pickTasks(payload: any): any[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload?.tasks)) return payload.tasks;
	if (Array.isArray(payload?.data)) return payload.data;
	if (Array.isArray(payload?.items)) return payload.items;
	if (Array.isArray(payload?.task)) return payload.task;
	return [];
}

async function withSignalFallback(
	dealId: string,
	signal: keyof HealthSignals,
	compute: () => Promise<number>
) {
	try {
		return clampScore(await compute());
	} catch (err) {
		console.error(`Health ${signal} signal failed for deal ${dealId}:`, err);
		return 50;
	}
}

async function getActiveDeals() {
	const clients = await listClients();
	const activeContactIds = new Set(
		clients
			.map((client) => client.zoho_contact_id)
			.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
	);

	if (activeContactIds.size === 0) return [];

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw new Error('Zoho is not connected yet.');
	}

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || tokens.api_domain || undefined;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain ?? null
		});
	}

	const deals: any[] = [];
	const perPage = 200;
	let page = 1;
	let moreRecords = true;

	while (moreRecords && deals.length < DEAL_LIMIT) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&page=${page}&per_page=${perPage}`,
			{},
			apiDomain
		);
		const rows = Array.isArray(response?.data) ? response.data : [];

		for (const deal of rows) {
			const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
			const contactId = getLookupId(deal?.Contact_Name);
			if (!isPortalActiveStage(stage) || !contactId || !activeContactIds.has(contactId)) {
				continue;
			}

			deals.push(deal);
			if (deals.length >= DEAL_LIMIT) break;
		}

		moreRecords = Boolean(response?.info?.more_records) && rows.length > 0 && deals.length < DEAL_LIMIT;
		page += 1;
	}

	return deals;
}

async function computeProjectHealth(deal: any): Promise<HealthProject> {
	const dealId = typeof deal?.id === 'string' ? deal.id : '';
	const projectName = getDealName(deal);
	const now = Date.now();

	const signals: HealthSignals = {
		schedule: await withSignalFallback(dealId, 'schedule', async () => {
			const projectId = parseZohoProjectIds(deal?.Project_ID)[0];
			if (!projectId) return 100;

			const response = await getProjectTasks(projectId, {
				status: 'all',
				view_type: 'all',
				per_page: 200
			});
			const tasks = pickTasks(response);
			if (tasks.length === 0) return 100;

			const overdueCount = tasks.filter((task) => {
				if (isTaskCompleted(task)) return false;
				const endDateCandidate =
					typeof task?.end_date === 'string'
						? task.end_date
						: typeof task?.end_date_string === 'string'
							? task.end_date_string
							: null;
				if (!endDateCandidate) return false;
				const endDate = new Date(endDateCandidate);
				if (Number.isNaN(endDate.getTime())) return false;
				return endDate.getTime() < now;
			}).length;

			const overduePercent = overdueCount / tasks.length;
			return 100 - overduePercent * 20;
		}),
		budget: 100,
		issues: await withSignalFallback(dealId, 'issues', async () => {
			const openIssues = await getOpenFieldIssuesForDeal(dealId);
			return 100 - openIssues.length * 15;
		}),
		decisions: await withSignalFallback(dealId, 'decisions', async () => {
			const pendingApprovals = await getPendingApprovalsForDeal(dealId);
			const totalPendingDays = pendingApprovals.reduce((sum, approval) => {
				return sum + (getDayDiff(approval.created_at, now) ?? 0);
			}, 0);
			return 100 - totalPendingDays * 5;
		}),
		comms: await withSignalFallback(dealId, 'comms', async () => {
			const comms = await getCommsForDeal(dealId);
			const latestComm = comms[0];
			const daysSinceLastComm = getDayDiff(latestComm?.created_at, now);
			if (daysSinceLastComm === null) return 50;
			const daysOverSla = Math.max(0, daysSinceLastComm - 2);
			return 100 - daysOverSla * 10;
		})
	};

	const score = clampScore(
		signals.schedule * 0.25 +
			signals.budget * 0.25 +
			signals.issues * 0.15 +
			signals.decisions * 0.2 +
			signals.comms * 0.15
	);

	return {
		deal_id: dealId,
		project_name: projectName,
		score,
		signals,
		status: getStatusFromScore(score)
	};
}

export const GET: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const deals = await getActiveDeals();
		const projects: HealthProject[] = [];

		for (const deal of deals) {
			const dealId = typeof deal?.id === 'string' ? deal.id : 'unknown';
			const projectName = getDealName(deal);

			try {
				projects.push(await computeProjectHealth(deal));
			} catch (err) {
				console.error(`Health computation failed for deal ${dealId}:`, err);
				const fallbackSignals: HealthSignals = {
					schedule: 50,
					budget: 50,
					issues: 50,
					decisions: 50,
					comms: 50
				};
				projects.push({
					deal_id: dealId,
					project_name: projectName,
					score: 50,
					signals: fallbackSignals,
					status: 'warning'
				});
			}
		}

		projects.sort((a, b) => a.score - b.score);
		return json({ data: projects });
	} catch (err) {
		console.error('GET /api/admin/health error:', err);
		const error = err instanceof Error ? err.message : 'Failed to compute health scores';
		return json({ error }, { status: 500 });
	}
};
