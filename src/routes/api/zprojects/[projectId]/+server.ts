import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getAllProjectActivities,
	getAllProjectTasks,
	getProject,
	getProjectIdsForContact,
	getProjectMilestones,
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

	const authorizedIds = await getProjectIdsForContact(zohoContactId);
	if (!authorizedIds.includes(projectId)) {
		throw error(403, 'Not authorized for this project');
	}

	try {
		const [projectRes, tasksRes, milestonesRes, activitiesRes] = await Promise.all([
			getProject(projectId),
			getAllProjectTasks(projectId, 100),
			getProjectMilestones(projectId),
			getAllProjectActivities(projectId, 50)
		]);

		const project = normalizeProjectResponse(projectRes);
		const tasks = Array.isArray(tasksRes) ? tasksRes : [];
		const milestones = pickArray(milestonesRes, 'milestones');
		const activities = Array.isArray(activitiesRes) ? activitiesRes : [];

		return json({ project, tasks, milestones, activities });
	} catch (err) {
		console.error('Failed to fetch Zoho Projects project detail:', err);
		throw error(500, 'Failed to fetch project');
	}
};
