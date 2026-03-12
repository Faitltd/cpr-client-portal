import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import {
	parseZohoProjectIds,
	getProject,
	getAllProjectTasks,
	getAllProjectActivities
} from '$lib/server/projects';

const projectTasksCache = new Map<string, { fetchedAt: number; tasks: any[] }>();
const PROJECT_TASKS_CACHE_TTL_MS = 2 * 60 * 1000;

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function normalizeProjectResponse(payload: any) {
	if (!payload) return null;
	if (payload.project && typeof payload.project === 'object') return payload.project;
	if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
	return payload;
}

function toCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
	if (typeof value === 'string') {
		const n = Number(value.trim());
		return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
	}
	return null;
}

function getTaskCountHint(project: any): number | null {
	const direct = toCount(project?.task_count ?? project?.tasks_count ?? project?.task_total);
	if (direct !== null) return direct;
	const t = project?.tasks;
	if (!t || typeof t !== 'object') return null;
	const total = toCount(t.total_count ?? t.count ?? t.total);
	if (total !== null) return total;
	const open = toCount(t.open_count ?? t.open);
	const closed = toCount(t.closed_count ?? t.closed);
	return open === null && closed === null ? null : (open ?? 0) + (closed ?? 0);
}

const getDealLabel = (deal: any) =>
	deal?.Deal_Name || deal?.Potential_Name || deal?.Name || deal?.name || null;

// GET /api/trade/projects/:projectId
// Returns Zoho Project detail (tasks + activities) for an authorized trade partner.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	if (!session.trade_partner.zoho_trade_partner_id) throw error(403, 'No linked trade partner');

	const { projectId } = params;
	if (!projectId) throw error(400, 'Project ID required');

	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho not configured');

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	// Build authorized project ID set and CRM deal map from trade partner's deals
	let authorizedProjectIds: Set<string>;
	let authorizedDealMap: Map<string, any>;
	let fallbackLink: { dealId: string | null; dealName: string | null; stage: string | null } | null =
		null;
	try {
		const dealList = await getTradePartnerDeals(accessToken);
		authorizedProjectIds = new Set<string>();
		authorizedDealMap = new Map<string, any>();
		for (const deal of dealList) {
			// Authorize by CRM deal ID (for fallback cards)
			if (deal?.id) authorizedDealMap.set(String(deal.id), deal);
			// Authorize by linked Zoho project IDs
			const ids = parseZohoProjectIds(deal?.Zoho_Projects_ID);
			for (const id of ids) {
				authorizedProjectIds.add(id);
				if (id === projectId) {
					fallbackLink = {
						dealId: deal?.id ? String(deal.id) : null,
						dealName: getDealLabel(deal),
						stage: typeof deal?.Stage === 'string' ? deal.Stage : null
					};
				}
			}
		}
	} catch (err) {
		console.error('Failed to verify trade partner project authorization:', err);
		throw error(500, 'Failed to verify authorization');
	}

	// If this is a CRM deal ID (not a Zoho project ID), return deal info directly
	if (!authorizedProjectIds.has(projectId)) {
		const deal = authorizedDealMap!.get(projectId);
		if (!deal) throw error(403, 'Not authorized for this project');
		return json({
			project: {
				id: projectId,
				deal_id: projectId,
				name: getDealLabel(deal) || `Deal ${projectId.slice(-6)}`,
				status: typeof deal.Stage === 'string' ? deal.Stage : 'Unknown',
				start_date: deal.Created_Time || null,
				end_date: deal.Closing_Date || null,
				source: 'crm_deal'
			},
			tasks: [],
			activities: []
		});
	}

	let projectPayload: any = null;
	try {
		projectPayload = await getProject(projectId);
	} catch (projectErr) {
		console.error('Failed to fetch Zoho Projects project detail:', projectErr);
		return json({
			project: {
				id: projectId,
				deal_id: fallbackLink?.dealId || null,
				name: fallbackLink?.dealName || `Project ${projectId}`,
				status: fallbackLink?.stage || 'Unknown'
			},
			tasks: [],
			activities: []
		});
	}

	const project = normalizeProjectResponse(projectPayload);
	if (!project) {
		return json({
			project: {
				id: projectId,
				deal_id: fallbackLink?.dealId || null,
				name: fallbackLink?.dealName || `Project ${projectId}`,
				status: fallbackLink?.stage || 'Unknown'
			},
			tasks: [],
			activities: []
		});
	}

	const taskCountHint = getTaskCountHint(project);
	const cachedTasks = projectTasksCache.get(projectId);
	const useTaskCache = cachedTasks && Date.now() - cachedTasks.fetchedAt < PROJECT_TASKS_CACHE_TTL_MS;

	const [tasksResult, activitiesResult] = await Promise.allSettled([
		useTaskCache
			? Promise.resolve(cachedTasks!.tasks)
			: taskCountHint === 0
				? Promise.resolve([])
				: getAllProjectTasks(projectId, 100),
		getAllProjectActivities(projectId, 50)
	]);

	const tasks =
		tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value) ? tasksResult.value : [];

	if (
		!useTaskCache &&
		tasksResult.status === 'fulfilled' &&
		Array.isArray(tasksResult.value) &&
		tasksResult.value.length > 0
	) {
		projectTasksCache.set(projectId, { fetchedAt: Date.now(), tasks: tasksResult.value });
	}

	const activities =
		activitiesResult.status === 'fulfilled' && Array.isArray(activitiesResult.value)
			? activitiesResult.value
			: [];

	return json({
		project: {
			...project,
			deal_id: fallbackLink?.dealId || project?.deal_id || null
		},
		tasks,
		activities
	});
};
