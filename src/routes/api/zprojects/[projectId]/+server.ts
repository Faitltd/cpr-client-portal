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

function normalizeProjectResponse(payload: any) {
	if (!payload) return null;
	if (payload.project && typeof payload.project === 'object') return payload.project;
	if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
	return payload;
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

	const [projectResult, tasksResult, milestonesResult, activitiesResult] = await Promise.allSettled([
		getProject(projectId),
		getAllProjectTasks(projectId, 100),
		getProjectMilestones(projectId),
		getAllProjectActivities(projectId, 50)
	]);

	if (projectResult.status === 'rejected') {
		console.error('Failed to fetch Zoho Projects project detail:', projectResult.reason);
		return json({
			project: toFallbackProject(link),
			tasks: [],
			milestones: [],
			activities: []
		});
	}

	const project = normalizeProjectResponse(projectResult.value);
	const tasks = tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value) ? tasksResult.value : [];
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
