import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getProject,
	getProjectIdsForContact,
	isProjectsPortalConfigured
} from '$lib/server/projects';

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	const workerCount = Math.min(limit, items.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex++;
			results[currentIndex] = await mapper(items[currentIndex], currentIndex);
		}
	});

	await Promise.all(workers);
	return results;
}

function normalizeProjectResponse(payload: any) {
	if (!payload) return null;
	if (payload.project && typeof payload.project === 'object') return payload.project;
	if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
	return payload;
}

// GET /api/zprojects
// Returns Zoho Projects linked to the client's CRM Deals (via Deal.Zoho_Projects_ID).
export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const zohoContactId = session.client?.zoho_contact_id;
	if (!zohoContactId) return json({ projects: [] });

	if (!isProjectsPortalConfigured()) {
		throw error(500, 'Zoho Projects portal is not configured');
	}

	try {
		const projectIds = await getProjectIdsForContact(zohoContactId);
		if (projectIds.length === 0) return json({ projects: [] });

		// Be mindful of Zoho Projects rate limits (100 requests / 2 min).
		// Lower parallelism for larger project sets while still returning all linked projects.
		const concurrency = projectIds.length > 25 ? 2 : 3;
		const projects = await mapWithConcurrency(projectIds, concurrency, async (projectId) => {
			try {
				const response = await getProject(projectId);
				return normalizeProjectResponse(response);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`Failed to fetch Zoho Projects project ${projectId}:`, message);
				return null;
			}
		});

		const normalized = projects.filter((project) => Boolean(project));
		if (normalized.length === 0) {
			throw error(502, 'Unable to fetch project details from Zoho Projects');
		}

		return json({ projects: normalized });
	} catch (err) {
		console.error('Failed to fetch Zoho Projects projects:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch projects');
	}
};
