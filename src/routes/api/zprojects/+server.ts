import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getProject,
	getProjectLinksForContact,
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

function getProjectId(project: any) {
	if (!project || typeof project !== 'object') return '';
	const id = project.id ?? project.project_id ?? project.project?.id ?? '';
	return id === null || id === undefined ? '' : String(id);
}

function toFallbackProjects(
	links: Array<{
		projectId: string;
		dealId: string | null;
		dealName: string | null;
		stage: string | null;
		modifiedTime: string | null;
	}>
) {
	return links.map((link) => ({
		id: link.projectId,
		name: link.dealName || `Project ${link.projectId}`,
		status: link.stage || 'Mapped in CRM',
		start_date: null,
		end_date: null,
		deal_id: link.dealId,
		modified_time: link.modifiedTime,
		source: 'crm'
	}));
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

	try {
		const links = await getProjectLinksForContact(zohoContactId);
		if (links.length === 0) return json({ projects: [] });

		if (!isProjectsPortalConfigured()) {
			return json({ projects: toFallbackProjects(links) });
		}

		const projectIds = links.map((link) => link.projectId);

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
			const seenIds = new Set(normalized.map((project) => getProjectId(project)).filter(Boolean));
			const merged = [
				...normalized,
				...toFallbackProjects(links).filter((project) => !seenIds.has(getProjectId(project)))
			];

			if (merged.length === 0) {
				return json({ projects: toFallbackProjects(links) });
			}

			return json({ projects: merged });
		} catch (err) {
			console.error('Failed to fetch Zoho Projects projects:', err);
			if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch projects');
	}
};
