import { env } from '$env/dynamic/private';
import { findContactByEmail, getContactDeals } from './auth';
import { getZohoTokens, upsertZohoTokens } from './db';
import { refreshAccessToken, zohoApiCall } from './zoho';

const DEFAULT_PROJECTS_API_BASE = 'https://projectsapi.zoho.com';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 25;
const CRM_RELATED_LIST_PAGE_SIZE = 200;
const CRM_RELATED_LIST_MAX_PAGES = 10;
const CRM_DEAL_EMAIL_FALLBACK_FIELDS = [
	'Deal_Name',
	'Stage',
	'Created_Time',
	'Modified_Time',
	'Closing_Date',
	'Contact_Name',
	'Zoho_Projects_ID'
].join(',');

function getProjectsApiBase() {
	const base = env.ZOHO_PROJECTS_API_BASE || DEFAULT_PROJECTS_API_BASE;
	return base.replace(/\/$/, '');
}

function getPortalId() {
	const portalId = env.ZOHO_PROJECTS_PORTAL_ID || '';
	if (!portalId) {
		throw new Error(
			'Missing ZOHO_PROJECTS_PORTAL_ID. Set it after calling the admin endpoint /api/zprojects/portals.'
		);
	}
	return portalId;
}

export function isProjectsPortalConfigured() {
	return Boolean(env.ZOHO_PROJECTS_PORTAL_ID);
}

function splitProjectIdString(value: string) {
	return value
		.split(/[,\n;]+/g)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseProjectIdsInternal(value: unknown, output: string[]) {
	if (value === null || value === undefined) return;

	if (typeof value === 'string') {
		output.push(...splitProjectIdString(value));
		return;
	}

	if (typeof value === 'number' || typeof value === 'bigint') {
		output.push(String(value));
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) parseProjectIdsInternal(item, output);
		return;
	}

	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const preferredKeys = ['id', 'project_id', 'projectId', 'value', 'display_value', 'displayValue'];
		for (const key of preferredKeys) {
			if (record[key] !== undefined) {
				parseProjectIdsInternal(record[key], output);
				return;
			}
		}
	}
}

export function parseZohoProjectIds(value: unknown): string[] {
	const rawIds: string[] = [];
	parseProjectIdsInternal(value, rawIds);

	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const id of rawIds) {
		const trimmed = id.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		normalized.push(trimmed);
	}
	return normalized;
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

function getProjectName(project: any) {
	if (!project || typeof project !== 'object') return null;
	const value = project.name ?? project.project_name ?? project.Project_Name ?? null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function getProjectId(project: any) {
	if (!project || typeof project !== 'object') return null;
	const id = project.id ?? project.project_id ?? project.project?.id ?? null;
	return id === null || id === undefined ? null : String(id);
}

function normalizeProjectMatchName(value: string) {
	return value
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripTrailingDateSuffix(value: string) {
	return value
		.replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, '')
		.replace(/\s*-\s*\d{4}-\d{2}-\d{2}\s*$/i, '')
		.trim();
}

function getDealNameCandidates(deal: any) {
	const dealName = getDealName(deal);
	if (!dealName) return [];
	const candidates = new Set<string>();
	candidates.add(dealName);
	const stripped = stripTrailingDateSuffix(dealName);
	if (stripped) candidates.add(stripped);
	return Array.from(candidates)
		.map((name) => normalizeProjectMatchName(name))
		.filter(Boolean);
}

function scoreProjectNameMatch(dealCandidate: string, projectName: string) {
	if (!dealCandidate || !projectName) return 0;
	if (dealCandidate === projectName) return 100;
	if (projectName.startsWith(dealCandidate) && dealCandidate.length >= 8) return 90;
	if (dealCandidate.startsWith(projectName) && projectName.length >= 8) return 88;
	if (projectName.includes(dealCandidate) && dealCandidate.length >= 10) return 84;
	return 0;
}

function findBestProjectMatchForDeal(
	deal: any,
	projects: any[],
	usedProjectIds: Set<string>
): { projectId: string; score: number } | null {
	const dealCandidates = getDealNameCandidates(deal);
	if (dealCandidates.length === 0) return null;

	let best: { projectId: string; score: number } | null = null;
	let secondBestScore = 0;

	for (const project of projects || []) {
		const projectId = getProjectId(project);
		if (!projectId || usedProjectIds.has(projectId)) continue;
		const projectNameRaw = getProjectName(project);
		if (!projectNameRaw) continue;
		const projectName = normalizeProjectMatchName(projectNameRaw);
		if (!projectName) continue;

		let score = 0;
		for (const candidate of dealCandidates) {
			score = Math.max(score, scoreProjectNameMatch(candidate, projectName));
		}

		if (score > (best?.score ?? 0)) {
			secondBestScore = best?.score ?? 0;
			best = { projectId, score };
		} else if (score > secondBestScore) {
			secondBestScore = score;
		}
	}

	if (!best) return null;
	if (best.score < 88) return null;
	if (best.score - secondBestScore < 5) return null;
	return best;
}

function getDealId(deal: any) {
	if (!deal || typeof deal !== 'object') return null;
	const id = deal.id ?? deal.Deal_ID ?? deal.deal_id ?? null;
	return id === null || id === undefined ? null : String(id);
}

function dedupeDealsById(deals: any[]) {
	const byId = new Map<string, any>();
	const unnamed: any[] = [];
	for (const deal of deals || []) {
		const id = getDealId(deal);
		if (!id) {
			unnamed.push(deal);
			continue;
		}
		if (!byId.has(id)) byId.set(id, deal);
	}
	return [...byId.values(), ...unnamed];
}

async function fetchContactEmailsByIds(accessToken: string, contactIds: string[]) {
	if (contactIds.length === 0) return new Map<string, string>();

	const emailByContactId = new Map<string, string>();
	const chunkSize = 100;

	for (let i = 0; i < contactIds.length; i += chunkSize) {
		const chunk = contactIds.slice(i, i + chunkSize);
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Contacts?ids=${chunk.join(',')}&fields=${encodeURIComponent('Email')}`
			);
			const contacts = Array.isArray(response.data) ? response.data : [];
			for (const contact of contacts) {
				const id = contact?.id ? String(contact.id) : '';
				const email = typeof contact?.Email === 'string' ? contact.Email.trim() : '';
				if (id && email) emailByContactId.set(id, email.toLowerCase());
			}
		} catch (err) {
			console.warn('Failed to fetch contacts chunk for deal-email fallback', {
				chunkSize: chunk.length,
				error: err
			});
		}
	}

	return emailByContactId;
}

async function fetchDealsByEmailFallback(accessToken: string, email: string) {
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail) return [];

	const perPage = 200;
	const maxPages = 20;
	const allDeals: any[] = [];

	for (let page = 1; page <= maxPages; page += 1) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent(CRM_DEAL_EMAIL_FALLBACK_FIELDS)}&per_page=${perPage}&page=${page}`
		);
		const deals = Array.isArray(response.data) ? response.data : [];
		if (deals.length === 0) break;

		allDeals.push(...deals);
		const hasMore = response.info?.more_records;
		if (hasMore === false) break;
		if (hasMore !== true && deals.length < perPage) break;
	}

	if (allDeals.length === 0) return [];

	const contactIdSet = new Set<string>();
	for (const deal of allDeals) {
		const contactId = deal?.Contact_Name?.id ? String(deal.Contact_Name.id) : '';
		if (contactId) contactIdSet.add(contactId);
	}

	const emailByContactId = await fetchContactEmailsByIds(accessToken, Array.from(contactIdSet));
	const matched = allDeals.filter((deal) => {
		const contactId = deal?.Contact_Name?.id ? String(deal.Contact_Name.id) : '';
		if (!contactId) return false;
		const contactEmail = emailByContactId.get(contactId);
		return Boolean(contactEmail && contactEmail === normalizedEmail);
	});

	return dedupeDealsById(matched);
}

export type ContactProjectLink = {
	projectId: string;
	dealId: string | null;
	dealName: string | null;
	stage: string | null;
	modifiedTime: string | null;
};

export type DealTaskPreview = {
	id: string;
	name: string;
	status: string | null;
	completed: boolean;
};

export type DealTaskSummary = {
	taskCount: number;
	completedCount: number;
	preview: DealTaskPreview[];
};

function hasMorePages(payload: any, itemCount: number, perPage: number) {
	const infoMoreRecords = payload?.info?.more_records;
	if (typeof infoMoreRecords === 'boolean') return infoMoreRecords;

	const pageContextMore =
		payload?.page_context?.has_more ??
		payload?.page_context?.more_records ??
		payload?.page_context?.has_more_records;
	if (typeof pageContextMore === 'boolean') return pageContextMore;

	const paginationMore =
		payload?.pagination?.has_more ??
		payload?.pagination?.more_records ??
		payload?.pagination?.has_more_records;
	if (typeof paginationMore === 'boolean') return paginationMore;

	return itemCount >= perPage;
}

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

async function fetchAllPages<T>(
	endpointFactory: (page: number, perPage: number) => string,
	arrayKey: string,
	perPage = DEFAULT_PAGE_SIZE
): Promise<T[]> {
	const results: T[] = [];

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const payload = await projectsApiCall(endpointFactory(page, perPage));
		const items = Array.isArray(payload?.[arrayKey]) ? (payload[arrayKey] as T[]) : [];
		if (items.length === 0) break;

		results.push(...items);

		if (!hasMorePages(payload, items.length, perPage)) break;
	}

	return results;
}

let accessTokenInFlight: Promise<string> | null = null;

// Re-uses the existing token refresh pattern from the CRM integration.
async function getValidAccessToken(): Promise<string> {
	if (accessTokenInFlight) return accessTokenInFlight;

	accessTokenInFlight = (async () => {
		const tokens = await getZohoTokens();
		if (!tokens) throw new Error('No Zoho tokens found');

		const expiresAtMs = new Date(tokens.expires_at).getTime();
		if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
			return tokens.access_token;
		}

		const refreshed = await refreshAccessToken(tokens.refresh_token);
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope ?? null
		});
		return refreshed.access_token;
	})();

	try {
		return await accessTokenInFlight;
	} finally {
		accessTokenInFlight = null;
	}
}

// Generic Zoho Projects API fetch wrapper.
// Base pattern: https://projectsapi.zoho.com/api/v3/portal/{portal_id}/...
export async function projectsApiCall(endpoint: string, options: RequestInit = {}) {
	const accessToken = await getValidAccessToken();
	const base = getProjectsApiBase();
	const portalId = getPortalId();
	const url = `${base}/api/v3/portal/${portalId}${endpoint}`;

	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (response.status === 204) return {};

	if (response.status === 429) {
		const text = await response.text().catch(() => '');
		console.warn(
			'Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.',
			{ endpoint, response: text }
		);
		throw new Error(`Zoho Projects API error 429: ${text}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Zoho Projects API error ${response.status}: ${text}`);
	}

	return response.json();
}

export async function listProjects(params?: {
	status?: 'active' | 'archived';
	page?: number;
	per_page?: number;
}) {
	const query = new URLSearchParams();
	if (params?.status) query.set('status', params.status);
	if (params?.page) query.set('page', String(params.page));
	if (params?.per_page) query.set('per_page', String(params.per_page));
	const qs = query.toString() ? `?${query}` : '';
	return projectsApiCall(`/projects${qs}`);
}

export async function listAllProjects(
	status: 'active' | 'archived' = 'active',
	perPage = DEFAULT_PAGE_SIZE
) {
	return fetchAllPages((page, size) => {
		const query = new URLSearchParams();
		query.set('status', status);
		query.set('page', String(page));
		query.set('per_page', String(size));
		return `/projects?${query}`;
	}, 'projects', perPage);
}

export async function getProject(projectId: string) {
	return projectsApiCall(`/projects/${projectId}`);
}

export async function getProjectTasks(
	projectId: string,
	params?: {
		page?: number;
		per_page?: number;
	}
) {
	const query = new URLSearchParams();
	if (params?.page) query.set('page', String(params.page));
	if (params?.per_page) query.set('per_page', String(params.per_page));
	const qs = query.toString() ? `?${query}` : '';
	return projectsApiCall(`/projects/${projectId}/tasks${qs}`);
}

export async function getProjectTasklists(projectId: string) {
	return projectsApiCall(`/projects/${projectId}/tasklists`);
}

export async function getProjectMilestones(projectId: string) {
	return projectsApiCall(`/projects/${projectId}/milestones`);
}

export async function getProjectActivities(
	projectId: string,
	params?: {
		page?: number;
		per_page?: number;
	}
) {
	const query = new URLSearchParams();
	if (params?.page) query.set('page', String(params.page));
	if (params?.per_page) query.set('per_page', String(params.per_page));
	const qs = query.toString() ? `?${query}` : '';
	return projectsApiCall(`/projects/${projectId}/activities${qs}`);
}

export async function getAllProjectTasks(projectId: string, perPage = DEFAULT_PAGE_SIZE) {
	return fetchAllPages((page, size) => `/projects/${projectId}/tasks?page=${page}&per_page=${size}`, 'tasks', perPage);
}

export async function getAllProjectActivities(projectId: string, perPage = DEFAULT_PAGE_SIZE) {
	return fetchAllPages(
		(page, size) => `/projects/${projectId}/activities?page=${page}&per_page=${size}`,
		'activities',
		perPage
	);
}

export async function getProjectUsers(projectId: string) {
	return projectsApiCall(`/projects/${projectId}/users`);
}

export async function getProjectDocuments(projectId: string) {
	return projectsApiCall(`/projects/${projectId}/documents`);
}

// Admin-only helper: list portals (use once to discover ZOHO_PROJECTS_PORTAL_ID).
export async function listPortals() {
	const accessToken = await getValidAccessToken();
	const base = getProjectsApiBase();

	const response = await fetch(`${base}/api/v3/portals`, {
		headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
	});

	if (response.status === 429) {
		const text = await response.text().catch(() => '');
		console.warn(
			'Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.',
			{ endpoint: '/api/v3/portals', response: text }
		);
		throw new Error(`Zoho Projects API error 429: ${text}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Portals API error ${response.status}: ${text}`);
	}

	return response.json();
}

function pickCrmArray(payload: any, arrayKey: string) {
	if (Array.isArray(payload?.data)) return payload.data as any[];
	if (Array.isArray(payload?.[arrayKey])) return payload[arrayKey] as any[];
	return [];
}

function readActivityType(record: any) {
	const value =
		record?.Activity_Type ??
		record?.activity_type ??
		record?.Type ??
		record?.type ??
		record?.$activity_type ??
		null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.toLowerCase() : null;
}

function isTaskActivity(record: any) {
	const type = readActivityType(record);
	return Boolean(type && type.includes('task'));
}

function getTaskName(record: any, index: number) {
	const candidates = [
		record?.Subject,
		record?.Task_Name,
		record?.name,
		record?.task_name,
		record?.title
	];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (trimmed) return trimmed;
	}
	return `Task ${index + 1}`;
}

function getTaskStatus(record: any) {
	const candidates = [record?.Status, record?.status, record?.Task_Status, record?.task_status];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

function getTaskPercent(record: any) {
	const candidates = [
		record?.Percent_Complete,
		record?.percent_complete,
		record?.percent_completed,
		record?.completed_percent,
		record?.Completion,
		record?.completion
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

function isTaskCompleted(record: any) {
	const status = getTaskStatus(record);
	const normalizedStatus = status ? status.toLowerCase() : '';
	if (
		normalizedStatus.includes('complete') ||
		normalizedStatus.includes('closed') ||
		normalizedStatus.includes('done') ||
		normalizedStatus.includes('resolved') ||
		normalizedStatus.includes('finished')
	) {
		return true;
	}

	const percent = getTaskPercent(record);
	if (typeof percent === 'number' && percent >= 100) return true;

	if (record?.Completed === true || record?.completed === true) return true;
	return false;
}

function toTaskPreview(record: any, index: number): DealTaskPreview {
	const id = record?.id ? String(record.id) : `task-${index + 1}`;
	return {
		id,
		name: getTaskName(record, index),
		status: getTaskStatus(record),
		completed: isTaskCompleted(record)
	};
}

function escapeCoqlString(value: string) {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function fetchDealTasksViaTasksSearch(accessToken: string, dealId: string) {
	const tasks: any[] = [];
	const encodedCriteria = encodeURIComponent(`(What_Id:equals:${dealId})`);

	for (let page = 1; page <= CRM_RELATED_LIST_MAX_PAGES; page += 1) {
		const response = await zohoApiCall(
			accessToken,
			`/Tasks/search?criteria=${encodedCriteria}&per_page=${CRM_RELATED_LIST_PAGE_SIZE}&page=${page}`
		);

		const items = pickCrmArray(response, 'Tasks');
		if (items.length === 0) break;
		tasks.push(...items);

		if (!hasMorePages(response, items.length, CRM_RELATED_LIST_PAGE_SIZE)) break;
	}

	return tasks;
}

async function countDealTasksViaTasksSearch(accessToken: string, dealId: string) {
	const tasks = await fetchDealTasksViaTasksSearch(accessToken, dealId);
	return tasks.length;
}

async function countDealTasksViaTasksCoql(accessToken: string, dealId: string) {
	let count = 0;
	const escapedDealId = escapeCoqlString(dealId);

	for (let page = 0; page < CRM_RELATED_LIST_MAX_PAGES; page += 1) {
		const offset = page * CRM_RELATED_LIST_PAGE_SIZE;
		const query = {
			select_query: `SELECT id FROM Tasks WHERE What_Id = '${escapedDealId}' LIMIT ${CRM_RELATED_LIST_PAGE_SIZE} OFFSET ${offset}`
		};

		const response = await zohoApiCall(accessToken, '/coql', {
			method: 'POST',
			body: JSON.stringify(query)
		});

		const items = pickCrmArray(response, 'data');
		if (items.length === 0) break;
		count += items.length;

		if (items.length < CRM_RELATED_LIST_PAGE_SIZE) break;
	}

	return count;
}

async function countDealRelatedListRecords(
	accessToken: string,
	dealId: string,
	relatedListApiName: string,
	options?: { taskOnly?: boolean }
) {
	const records: any[] = [];

	for (let page = 1; page <= CRM_RELATED_LIST_MAX_PAGES; page += 1) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(relatedListApiName)}?per_page=${CRM_RELATED_LIST_PAGE_SIZE}&page=${page}`
		);

		const items = pickCrmArray(response, relatedListApiName);
		if (items.length === 0) break;

		if (options?.taskOnly) {
			const typedTasks = items.filter((item) => isTaskActivity(item));
			const hasTypedActivities = items.some((item) => readActivityType(item) !== null);
			records.push(...(hasTypedActivities ? typedTasks : items));
		} else {
			records.push(...items);
		}

		if (!hasMorePages(response, items.length, CRM_RELATED_LIST_PAGE_SIZE)) break;
	}

	return records.length;
}

async function fetchDealTasksViaRelatedList(
	accessToken: string,
	dealId: string,
	relatedListApiName: string,
	options?: { taskOnly?: boolean }
) {
	let count = 0;
	const records: any[] = [];

	for (let page = 1; page <= CRM_RELATED_LIST_MAX_PAGES; page += 1) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(relatedListApiName)}?per_page=${CRM_RELATED_LIST_PAGE_SIZE}&page=${page}`
		);

		const items = pickCrmArray(response, relatedListApiName);
		if (items.length === 0) break;

		if (options?.taskOnly) {
			const typedTasks = items.filter((item) => isTaskActivity(item));
			const hasTypedActivities = items.some((item) => readActivityType(item) !== null);
			const taskItems = hasTypedActivities ? typedTasks : items;
			count += taskItems.length;
			records.push(...taskItems);
		} else {
			count += items.length;
			records.push(...items);
		}

		if (!hasMorePages(response, items.length, CRM_RELATED_LIST_PAGE_SIZE)) break;
	}

	if (count === 0) return [];
	return records;
}

async function getDealTaskCount(accessToken: string, dealId: string): Promise<number | null> {
	const successfulCounts: number[] = [];

	try {
		successfulCounts.push(await countDealTasksViaTasksSearch(accessToken, dealId));
	} catch {
		// Continue trying additional task-count strategies.
	}

	try {
		successfulCounts.push(await countDealTasksViaTasksCoql(accessToken, dealId));
	} catch {
		// Continue trying additional task-count strategies.
	}

	const candidates: Array<{ apiName: string; taskOnly?: boolean }> = [
		{ apiName: 'Tasks' },
		{ apiName: 'Activities', taskOnly: true },
		{ apiName: 'Open_Activities', taskOnly: true }
	];

	for (const candidate of candidates) {
		try {
			const count = await countDealRelatedListRecords(accessToken, dealId, candidate.apiName, {
				taskOnly: candidate.taskOnly
			});
			successfulCounts.push(count);
		} catch {
			// Continue trying additional related-list candidates.
		}
	}

	if (successfulCounts.length === 0) return null;
	return Math.max(...successfulCounts);
}

async function getDealTaskSummary(
	accessToken: string,
	dealId: string,
	previewLimit = 4
): Promise<DealTaskSummary | null> {
	let records: any[] | null = null;

	try {
		records = await fetchDealTasksViaTasksSearch(accessToken, dealId);
	} catch {
		records = null;
	}

	if (!records || records.length === 0) {
		try {
			records = await fetchDealTasksViaRelatedList(accessToken, dealId, 'Tasks');
		} catch {
			records = null;
		}
	}

	if (!records || records.length === 0) {
		try {
			records = await fetchDealTasksViaRelatedList(accessToken, dealId, 'Activities', { taskOnly: true });
		} catch {
			records = null;
		}
	}

	if (!records || records.length === 0) {
		try {
			records = await fetchDealTasksViaRelatedList(accessToken, dealId, 'Open_Activities', { taskOnly: true });
		} catch {
			records = null;
		}
	}

	if (!records) return null;

	const taskCount = records.length;
	const completedCount = records.filter((record) => isTaskCompleted(record)).length;
	const preview = records.slice(0, Math.max(0, previewLimit)).map((record, index) => toTaskPreview(record, index));
	return { taskCount, completedCount, preview };
}

export async function getDealTaskSummaries(
	dealIds: string[],
	options?: { concurrency?: number; previewLimit?: number }
): Promise<Map<string, DealTaskSummary | null>> {
	const normalizedIds = Array.from(
		new Set(
			(dealIds || [])
				.map((id) => (id === null || id === undefined ? '' : String(id).trim()))
				.filter(Boolean)
		)
	);
	const summariesByDealId = new Map<string, DealTaskSummary | null>();
	if (normalizedIds.length === 0) return summariesByDealId;

	const accessToken = await getValidAccessToken();
	const workerLimit = Math.max(1, Math.min(options?.concurrency ?? 2, 4));
	const previewLimit = Math.max(0, Math.min(options?.previewLimit ?? 4, 8));

	const results = await mapWithConcurrency(normalizedIds, workerLimit, async (dealId) => {
		try {
			const summary = await getDealTaskSummary(accessToken, dealId, previewLimit);
			return { dealId, summary };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn('Failed to fetch CRM task summary for deal', { dealId, error: message });
			return { dealId, summary: null as DealTaskSummary | null };
		}
	});

	for (const result of results) {
		summariesByDealId.set(result.dealId, result.summary);
	}

	return summariesByDealId;
}

export async function getDealTaskCounts(
	dealIds: string[],
	concurrency = 2
): Promise<Map<string, number | null>> {
	const normalizedIds = Array.from(
		new Set(
			(dealIds || [])
				.map((id) => (id === null || id === undefined ? '' : String(id).trim()))
				.filter(Boolean)
		)
	);
	const countsByDealId = new Map<string, number | null>();
	if (normalizedIds.length === 0) return countsByDealId;

	const accessToken = await getValidAccessToken();
	const workerLimit = Math.max(1, Math.min(concurrency, 4));

	const results = await mapWithConcurrency(normalizedIds, workerLimit, async (dealId) => {
		try {
			const taskCount = await getDealTaskCount(accessToken, dealId);
			return { dealId, taskCount };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn('Failed to fetch CRM task count for deal', { dealId, error: message });
			return { dealId, taskCount: null as number | null };
		}
	});

	for (const result of results) {
		countsByDealId.set(result.dealId, result.taskCount);
	}

	return countsByDealId;
}

// Map CRM Deals -> Zoho Projects projects via a custom Deal field: Zoho_Projects_ID.
export async function getProjectIdsForContact(zohoContactId: string): Promise<string[]> {
	const links = await getProjectLinksForContact(zohoContactId);
	return links.map((link) => link.projectId);
}

export async function getProjectLinksForContact(zohoContactId: string): Promise<ContactProjectLink[]> {
	return getProjectLinksForClient(zohoContactId, null);
}

export async function getDealsForClient(
	zohoContactId: string | null | undefined,
	email?: string | null
): Promise<any[]> {
	const accessToken = await getValidAccessToken();
	const trimmedContactId = zohoContactId ? String(zohoContactId).trim() : '';
	const trimmedEmail = email ? String(email).trim() : '';
	const collectedDeals: any[] = [];

	if (trimmedContactId) {
		try {
			const primaryDeals = await getContactDeals(accessToken, trimmedContactId);
			if (Array.isArray(primaryDeals) && primaryDeals.length > 0) {
				collectedDeals.push(...primaryDeals);
				return dedupeDealsById(collectedDeals);
			}
		} catch (err) {
			console.warn('Failed to fetch deals by session contact id', { contactId: trimmedContactId, err });
		}
	}

	if (trimmedEmail) {
		try {
			const contact = await findContactByEmail(accessToken, trimmedEmail);
			const resolvedContactId = contact?.zoho_contact_id ? String(contact.zoho_contact_id).trim() : '';
			if (resolvedContactId && resolvedContactId !== trimmedContactId) {
				const emailMatchedDeals = await getContactDeals(accessToken, resolvedContactId);
				if (Array.isArray(emailMatchedDeals) && emailMatchedDeals.length > 0) {
					collectedDeals.push(...emailMatchedDeals);
				}
			}
		} catch (err) {
			console.warn('Failed to resolve contact by email for deals fallback', { email: trimmedEmail, err });
		}

		if (collectedDeals.length === 0) {
			try {
				const emailMatchedDeals = await fetchDealsByEmailFallback(accessToken, trimmedEmail);
				if (emailMatchedDeals.length > 0) {
					collectedDeals.push(...emailMatchedDeals);
				}
			} catch (err) {
				console.warn('Failed to fetch deals by email fallback scan', { email: trimmedEmail, err });
			}
		}
	}

	return dedupeDealsById(collectedDeals);
}

export async function getProjectLinksForClient(
	zohoContactId: string | null | undefined,
	email?: string | null
): Promise<ContactProjectLink[]> {
	const deals = await getDealsForClient(zohoContactId, email);

	const byProjectId = new Map<string, ContactProjectLink>();
	for (const deal of deals || []) {
		const raw = (deal as any)?.Zoho_Projects_ID;
		const ids = parseZohoProjectIds(raw);
		if (ids.length === 0) continue;

		const dealId = deal?.id ? String(deal.id) : null;
		const dealName = getDealName(deal);
		const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
		const modifiedTime = typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null;

		for (const projectId of ids) {
			if (byProjectId.has(projectId)) continue;
			byProjectId.set(projectId, {
				projectId,
				dealId,
				dealName,
				stage,
				modifiedTime
			});
		}
	}

	// Fallback discovery: if a deal is missing Zoho_Projects_ID, try to match it by name
	// against active Zoho Projects so clients still land on real project detail/tasks.
	const unmappedDeals = (deals || []).filter((deal) => {
		const ids = parseZohoProjectIds((deal as any)?.Zoho_Projects_ID);
		return ids.length === 0;
	});

	if (unmappedDeals.length > 0 && isProjectsPortalConfigured()) {
		try {
			const projects = await listAllProjects('active', 100);
			const usedProjectIds = new Set<string>(byProjectId.keys());

			for (const deal of unmappedDeals) {
				const match = findBestProjectMatchForDeal(deal, projects, usedProjectIds);
				if (!match) continue;

				const dealId = deal?.id ? String(deal.id) : null;
				const dealName = getDealName(deal);
				const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
				const modifiedTime = typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null;

				usedProjectIds.add(match.projectId);
				byProjectId.set(match.projectId, {
					projectId: match.projectId,
					dealId,
					dealName,
					stage,
					modifiedTime
				});
			}
		} catch (err) {
			console.warn('Failed to discover Zoho Projects links by deal-name matching', err);
		}
	}

	return Array.from(byProjectId.values());
}
