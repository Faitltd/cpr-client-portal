import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getAllProjectActivities,
	getAllProjectTasks,
	getProject,
	getProjectLinksForClient,
	getProjectMilestones
} from '$lib/server/projects';

const projectTasksCache = new Map<string, { fetchedAt: number; tasks: any[] }>();
const PROJECT_TASKS_CACHE_TTL_MS = 2 * 60 * 1000;

function normalizeProjectResponse(payload: any) {
	if (!payload) return null;
	if (payload.project && typeof payload.project === 'object') return payload.project;
	if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
	return payload;
}

function toCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value >= 0 ? Math.round(value) : null;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
		return null;
	}
	return null;
}

function getTaskCountHint(project: any): number | null {
	const direct = toCount(project?.task_count ?? project?.tasks_count ?? project?.task_total);
	if (direct !== null) return direct;
	const tasks = project?.tasks;
	if (!tasks || typeof tasks !== 'object') return null;
	const total = toCount(tasks.total_count ?? tasks.count ?? tasks.total);
	if (total !== null) return total;
	const open = toCount(tasks.open_count ?? tasks.open);
	const closed = toCount(tasks.closed_count ?? tasks.closed);
	if (open === null && closed === null) return null;
	return (open ?? 0) + (closed ?? 0);
}

function pickArray(payload: any, key: string) {
	const value = payload?.[key];
	return Array.isArray(value) ? value : [];
}

function toFallbackProject(link: {
	projectId: string;
	dealId: string | null;
	dealName: string | null;
	stage: string | null;
	modifiedTime: string | null;
}) {
	return {
		id: link.projectId,
		name: link.dealName || `Project ${link.projectId}`,
		status: link.stage || 'Mapped in CRM',
		start_date: null,
		end_date: null,
		deal_id: link.dealId,
		modified_time: link.modifiedTime,
		source: 'crm'
	};
}

// GET /api/zprojects/:projectId
// Returns project detail with tasks, milestones, and recent activities.
//
// Rate limit note: this endpoint makes 4 parallel Zoho Projects API calls per load
// (project, tasks, milestones, activities). Zoho Projects allows 100 requests / 2 min.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const zohoContactId = session.client?.zoho_contact_id;
	if (!zohoContactId) throw error(403, 'No linked contact');

	const projectId = params.projectId;
	if (!projectId) throw error(400, 'Project ID required');

	const projectLinks = await getProjectLinksForClient(zohoContactId, session.client?.email ?? null);
	const link = projectLinks.find((item) => item.projectId === projectId);
	if (!link) {
		throw error(403, 'Not authorized for this project');
	}

	let projectPayload: any = null;
	try {
		projectPayload = await getProject(projectId);
	} catch (projectErr) {
		console.error('Failed to fetch Zoho Projects project detail:', projectErr);
		return json({
			project: toFallbackProject(link),
			tasks: [],
			milestones: [],
			activities: []
		});
	}

	const project = normalizeProjectResponse(projectPayload);
	const taskCountHint = getTaskCountHint(project);
	const cachedTasks = projectTasksCache.get(projectId);
	const useTaskCache = cachedTasks && Date.now() - cachedTasks.fetchedAt < PROJECT_TASKS_CACHE_TTL_MS;
	const [tasksResult, milestonesResult, activitiesResult] = await Promise.allSettled([
		useTaskCache
			? Promise.resolve(cachedTasks!.tasks)
			: taskCountHint === 0
				? Promise.resolve([])
				: getAllProjectTasks(projectId, 100),
		getProjectMilestones(projectId),
		getAllProjectActivities(projectId, 50)
	]);

	if (!project) {
		console.error('Failed to normalize Zoho Projects project detail payload for project:', projectId);
		return json({
			project: toFallbackProject(link),
			tasks: [],
			milestones: [],
			activities: []
		});
	}
	const tasks = tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value) ? tasksResult.value : [];
	if (
		!useTaskCache &&
		tasksResult.status === 'fulfilled' &&
		Array.isArray(tasksResult.value) &&
		tasksResult.value.length > 0
	) {
		projectTasksCache.set(projectId, { fetchedAt: Date.now(), tasks: tasksResult.value });
	}
	const milestones =
		milestonesResult.status === 'fulfilled' ? pickArray(milestonesResult.value, 'milestones') : [];
	const activities =
		activitiesResult.status === 'fulfilled' && Array.isArray(activitiesResult.value)
			? activitiesResult.value
			: [];

	if (tasksResult.status === 'rejected') {
		console.warn(`Failed to fetch Zoho Projects tasks for ${projectId}:`, tasksResult.reason);
	}
	if (milestonesResult.status === 'rejected') {
		console.warn(`Failed to fetch Zoho Projects milestones for ${projectId}:`, milestonesResult.reason);
	}
	if (activitiesResult.status === 'rejected') {
		console.warn(`Failed to fetch Zoho Projects activities for ${projectId}:`, activitiesResult.reason);
	}

	return json({ project, tasks, milestones, activities });
};
