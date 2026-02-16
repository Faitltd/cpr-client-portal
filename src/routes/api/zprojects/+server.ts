import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getDealsForClient,
	getProject,
	getProjectLinksForClient,
	isProjectsPortalConfigured,
	parseZohoProjectIds
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

function getLookupName(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const candidate = record.name ?? record.display_value ?? record.displayValue ?? null;
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function getDealName(deal: any) {
	if (!deal) return null;
	if (typeof deal.Deal_Name === 'string' && deal.Deal_Name.trim()) return deal.Deal_Name.trim();
	return getLookupName(deal.Deal_Name);
}

function toMappedFallbackProjects(
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

function toUnmappedDealProjects(deals: any[]) {
	const items: any[] = [];
	const seen = new Set<string>();
	for (const deal of deals || []) {
		const dealId = deal?.id ? String(deal.id) : '';
		if (!dealId || seen.has(dealId)) continue;
		seen.add(dealId);

		const projectIds = parseZohoProjectIds(deal?.Zoho_Projects_ID);
		if (projectIds.length > 0) continue;

		items.push({
			id: dealId,
			deal_id: dealId,
			name: getDealName(deal) || `Deal ${dealId.slice(-6)}`,
			status: typeof deal?.Stage === 'string' ? deal.Stage : 'Unknown',
			start_date: typeof deal?.Created_Time === 'string' ? deal.Created_Time : null,
			end_date: typeof deal?.Closing_Date === 'string' ? deal.Closing_Date : null,
			task_count: null,
			milestone_count: null,
			source: 'crm_deal'
		});
	}
	return items;
}

function dedupeProjects(projects: any[]) {
	const seen = new Set<string>();
	const deduped: any[] = [];
	for (const project of projects || []) {
		const id = getProjectId(project);
		const source = project?.source ? String(project.source) : 'zprojects';
		const key = `${source}:${id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(project);
	}
	return deduped;
}

// GET /api/zprojects
// Returns client projects from Zoho Projects when configured, with CRM fallback for unmapped deals.
export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const zohoContactId = session.client?.zoho_contact_id ?? null;
	const clientEmail = session.client?.email ?? null;

	try {
		const [links, deals] = await Promise.all([
			getProjectLinksForClient(zohoContactId, clientEmail),
			getDealsForClient(zohoContactId, clientEmail)
		]);

		const unmappedDealProjects = toUnmappedDealProjects(deals);

		if (links.length === 0) {
			return json({ projects: dedupeProjects(unmappedDealProjects) });
		}

		const mappedFallbackProjects = toMappedFallbackProjects(links);

		if (!isProjectsPortalConfigured()) {
			return json({ projects: dedupeProjects([...mappedFallbackProjects, ...unmappedDealProjects]) });
		}

		const projectIds = links.map((link) => link.projectId);
		const concurrency = projectIds.length > 25 ? 2 : 3;

		try {
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

			const normalized = projects.filter(Boolean);
			const seenIds = new Set(normalized.map((project) => getProjectId(project)).filter(Boolean));
			const missingMappedProjects = mappedFallbackProjects.filter(
				(project) => !seenIds.has(getProjectId(project))
			);

			return json({
				projects: dedupeProjects([...normalized, ...missingMappedProjects, ...unmappedDealProjects])
			});
		} catch (err) {
			console.error('Zoho Projects lookup failed, returning fallback data:', err);
			return json({ projects: dedupeProjects([...mappedFallbackProjects, ...unmappedDealProjects]) });
		}
	} catch (err) {
		console.error('Failed to fetch client projects list:', err);
		throw error(500, 'Failed to fetch projects');
	}
};

