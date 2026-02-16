import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/db';
import {
	getAllProjectTasks,
	getDealTaskSummaries,
	getDealsForClient,
	getProject,
	getProjectLinksForClient,
	parseZohoProjectIds
} from '$lib/server/projects';

const MAX_DEAL_TASK_LOOKUPS = 30;
const MAX_PROJECT_TASK_LOOKUPS = 20;
const PROJECT_TASK_PREVIEW_LIMIT = 4;

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

	if (Array.isArray(value)) {
		return value.length;
	}

	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const candidateKeys = ['count', 'total', 'size', 'open', 'value'];
		for (const key of candidateKeys) {
			if (record[key] === undefined) continue;
			const parsed = toCount(record[key]);
			if (parsed !== null) return parsed;
		}
	}

	return null;
}

function getDealTaskCountHint(deal: any): number | null {
	const candidateKeys = [
		'task_count',
		'tasks_count',
		'Task_Count',
		'Tasks_Count',
		'Open_Activities',
		'open_activities',
		'Activities',
		'activities'
	];

	for (const key of candidateKeys) {
		const parsed = toCount(deal?.[key]);
		if (parsed !== null) return parsed;
	}

	return null;
}

function buildDealTaskHintMap(deals: any[]) {
	const counts = new Map<string, number | null>();
	for (const deal of deals || []) {
		const dealId = deal?.id ? String(deal.id) : '';
		if (!dealId || counts.has(dealId)) continue;
		const hint = getDealTaskCountHint(deal);
		if (hint !== null) counts.set(dealId, hint);
	}
	return counts;
}

function getProjectTaskName(task: any, index: number) {
	const candidates = [task?.name, task?.task_name, task?.title];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (trimmed) return trimmed;
	}
	return `Task ${index + 1}`;
}

function getProjectTaskStatus(task: any) {
	const candidates = [task?.status, task?.task_status, task?.status_name];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (trimmed) return trimmed;
	}
	return 'Open';
}

function getProjectTaskPercent(task: any) {
	const candidates = [
		task?.percent_complete,
		task?.percent_completed,
		task?.completed_percent,
		task?.completion_percentage
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
		if (typeof candidate === 'string') {
			const parsed = Number(candidate.trim().replace('%', ''));
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

function isProjectTaskCompleted(task: any) {
	const status = getProjectTaskStatus(task).toLowerCase();
	if (
		status.includes('complete') ||
		status.includes('closed') ||
		status.includes('done') ||
		status.includes('finished')
	) {
		return true;
	}
	const percent = getProjectTaskPercent(task);
	return typeof percent === 'number' && percent >= 100;
}

function attachProjectTaskSummary(project: any, tasks: any[]) {
	if (!project || typeof project !== 'object') return project;
	if (!Array.isArray(tasks)) return project;

	const taskCount = tasks.length;
	const completedCount = tasks.filter((task) => isProjectTaskCompleted(task)).length;
	const taskPreview = tasks.slice(0, PROJECT_TASK_PREVIEW_LIMIT).map((task, index) => ({
		id: task?.id ? String(task.id) : `task-${index + 1}`,
		name: getProjectTaskName(task, index),
		status: getProjectTaskStatus(task),
		completed: isProjectTaskCompleted(task)
	}));

	return {
		...project,
		task_count: taskCount,
		task_completed_count: completedCount,
		task_preview: taskPreview
	};
}

function toMappedFallbackProjects(
	links: Array<{
		projectId: string;
		dealId: string | null;
		dealName: string | null;
		stage: string | null;
		modifiedTime: string | null;
	}>,
	taskCountsByDealId: Map<string, number | null>,
	taskCompletedByDealId: Map<string, number | null>,
	taskPreviewByDealId: Map<string, any[]>
) {
	return links.map((link) => ({
		id: link.projectId,
		name: link.dealName || `Project ${link.projectId}`,
		status: link.stage || 'Mapped in CRM',
		start_date: null,
		end_date: null,
		task_count: link.dealId ? (taskCountsByDealId.get(link.dealId) ?? 0) : 0,
		task_completed_count: link.dealId ? (taskCompletedByDealId.get(link.dealId) ?? null) : null,
		task_preview: link.dealId ? (taskPreviewByDealId.get(link.dealId) ?? []) : [],
		milestone_count: null,
		deal_id: link.dealId,
		modified_time: link.modifiedTime,
		source: 'crm'
	}));
}

function toUnmappedDealProjects(
	deals: any[],
	taskCountsByDealId: Map<string, number | null>,
	taskCompletedByDealId: Map<string, number | null>,
	taskPreviewByDealId: Map<string, any[]>,
	linkedDealIds: Set<string>
) {
	const items: any[] = [];
	const seen = new Set<string>();
	for (const deal of deals || []) {
		const dealId = deal?.id ? String(deal.id) : '';
		if (!dealId || seen.has(dealId)) continue;
		seen.add(dealId);
		if (linkedDealIds.has(dealId)) continue;

		const projectIds = parseZohoProjectIds(deal?.Zoho_Projects_ID);
		if (projectIds.length > 0) continue;

		const taskCountFromMap = taskCountsByDealId.get(dealId);
		const taskCountFromDeal = getDealTaskCountHint(deal);
		const taskCount =
			taskCountFromMap !== null && taskCountFromMap !== undefined
				? taskCountFromMap
				: taskCountFromDeal !== null && taskCountFromDeal !== undefined
					? taskCountFromDeal
					: 0;

			items.push({
				id: dealId,
				deal_id: dealId,
				name: getDealName(deal) || `Deal ${dealId.slice(-6)}`,
				status: typeof deal?.Stage === 'string' ? deal.Stage : 'Unknown',
				start_date: typeof deal?.Created_Time === 'string' ? deal.Created_Time : null,
				end_date: typeof deal?.Closing_Date === 'string' ? deal.Closing_Date : null,
				task_count: taskCount,
				task_completed_count: taskCompletedByDealId.get(dealId) ?? null,
				task_preview: taskPreviewByDealId.get(dealId) ?? [],
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
export const GET: RequestHandler = async ({ cookies, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');
	const debugEnabled = url.searchParams.get('debug') === '1';

	const zohoContactId = session.client?.zoho_contact_id ?? null;
	const clientEmail = session.client?.email ?? null;

	try {
		const [links, deals] = await Promise.all([
			getProjectLinksForClient(zohoContactId, clientEmail),
			getDealsForClient(zohoContactId, clientEmail)
		]);
		const debug: Record<string, unknown> = debugEnabled
			? {
					client: {
						zohoContactId,
						email: clientEmail
					},
					counts: {
						deals: deals.length,
						links: links.length
					},
					links: links.slice(0, 20).map((link) => ({
						projectId: link.projectId,
						dealId: link.dealId,
						dealName: link.dealName,
						stage: link.stage
					}))
				}
			: {};

		const taskCountsByDealId = buildDealTaskHintMap(deals);
		const taskCompletedByDealId = new Map<string, number | null>();
		const taskPreviewByDealId = new Map<string, any[]>();
		const linkedDealIds = new Set<string>(
			(links || [])
				.map((link) => (link?.dealId ? String(link.dealId) : ''))
				.filter((dealId) => Boolean(dealId))
		);
		const dealIds = Array.from(
			new Set(
				(deals || [])
					.map((deal) => (deal?.id ? String(deal.id) : ''))
					.filter((dealId) => Boolean(dealId) && !linkedDealIds.has(dealId))
			)
		);
		const dealIdsToLookup = dealIds.slice(0, MAX_DEAL_TASK_LOOKUPS);
		if (dealIdsToLookup.length > 0) {
			try {
				const fetchedTaskSummaries = await getDealTaskSummaries(dealIdsToLookup, {
					concurrency: 2,
					previewLimit: 4
				});
				for (const [dealId, summary] of fetchedTaskSummaries.entries()) {
					if (summary && typeof summary.taskCount === 'number') {
						taskCountsByDealId.set(dealId, summary.taskCount);
					}
					if (summary && typeof summary.completedCount === 'number') {
						taskCompletedByDealId.set(dealId, summary.completedCount);
					}
					taskPreviewByDealId.set(dealId, summary?.preview || []);
				}
			} catch (err) {
				console.warn('Failed to fetch CRM task summaries for deal fallback cards:', err);
			}
		}

		const unmappedDealProjects = toUnmappedDealProjects(
			deals,
			taskCountsByDealId,
			taskCompletedByDealId,
			taskPreviewByDealId,
			linkedDealIds
		);

		if (links.length === 0) {
			return json({ projects: dedupeProjects(unmappedDealProjects) });
		}

		const mappedFallbackProjects = toMappedFallbackProjects(
			links,
			taskCountsByDealId,
			taskCompletedByDealId,
			taskPreviewByDealId
		);

		const projectIds = links.map((link) => link.projectId);
		const concurrency = projectIds.length > 10 ? 2 : 3;
		const projectFetchErrors = new Map<string, string>();
		const projectTaskFetchErrors = new Map<string, string>();

		try {
			const projects = await mapWithConcurrency(projectIds, concurrency, async (projectId, index) => {
				try {
					const response = await getProject(projectId);
					const project = normalizeProjectResponse(response);
					if (!project) return null;

					if (index >= MAX_PROJECT_TASK_LOOKUPS) return project;

					try {
						const tasks = await getAllProjectTasks(projectId, 100);
						return attachProjectTaskSummary(project, Array.isArray(tasks) ? tasks : []);
					} catch (taskErr) {
						const message = taskErr instanceof Error ? taskErr.message : String(taskErr);
						console.warn(`Failed to fetch Zoho Projects tasks for ${projectId}:`, message);
						projectTaskFetchErrors.set(projectId, message);
						return project;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`Failed to fetch Zoho Projects project ${projectId}:`, message);
					projectFetchErrors.set(projectId, message);
					return null;
				}
			});

			const normalized = projects.filter(Boolean);
			const seenIds = new Set(normalized.map((project) => getProjectId(project)).filter(Boolean));
				const missingMappedProjects = mappedFallbackProjects.filter(
					(project) => !seenIds.has(getProjectId(project))
				);
				if (debugEnabled) {
					debug.normalizedProjectCount = normalized.length;
					debug.missingMappedProjectCount = missingMappedProjects.length;
					debug.projectFetchErrors = Array.from(projectFetchErrors.entries()).map(([projectId, message]) => ({
						projectId,
						message
					}));
					debug.projectTaskFetchErrors = Array.from(projectTaskFetchErrors.entries()).map(
						([projectId, message]) => ({
							projectId,
							message
						})
					);
				}

				if (normalized.length > 0) {
					const payload: Record<string, unknown> = {
						projects: dedupeProjects([...normalized, ...missingMappedProjects])
					};
					if (debugEnabled) payload._debug = debug;
					return json(payload);
				}

				const payload: Record<string, unknown> = {
					projects: dedupeProjects([...normalized, ...missingMappedProjects, ...unmappedDealProjects])
				};
				if (debugEnabled) payload._debug = debug;
				return json(payload);
		} catch (err) {
			console.error('Zoho Projects lookup failed, returning fallback data:', err);
			if (debugEnabled) {
				debug.lookupError = err instanceof Error ? err.message : String(err);
			}
			const payload: Record<string, unknown> = {
				projects: dedupeProjects([...mappedFallbackProjects, ...unmappedDealProjects])
			};
			if (debugEnabled) payload._debug = debug;
			return json(payload);
		}
	} catch (err) {
		console.error('Failed to fetch client projects list:', err);
		throw error(500, 'Failed to fetch projects');
	}
};
