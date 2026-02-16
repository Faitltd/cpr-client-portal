import { env } from '$env/dynamic/private';
import { findContactByEmail, getContactDeals } from './auth';
import { getZohoTokens, upsertZohoTokens } from './db';
import { refreshAccessToken } from './zoho';

const DEFAULT_PROJECTS_API_BASE = 'https://projectsapi.zoho.com';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 25;

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

export type ContactProjectLink = {
	projectId: string;
	dealId: string | null;
	dealName: string | null;
	stage: string | null;
	modifiedTime: string | null;
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

	return Array.from(byProjectId.values());
}
