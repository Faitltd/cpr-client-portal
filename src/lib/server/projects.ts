import { env } from '$env/dynamic/private';
import { findContactByEmail, getContactDeals, isPortalActiveStage } from './auth';
import { getZohoTokens, upsertZohoTokens } from './db';
import { refreshAccessToken, zohoApiCall } from './zoho';
import { createLogger } from '$lib/server/logger';

const log = createLogger('projects');

const DEFAULT_PROJECTS_API_BASE = 'https://projectsapi.zoho.com';
const DEFAULT_PROJECTS_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 25;
const CRM_RELATED_LIST_PAGE_SIZE = 200;
const CRM_RELATED_LIST_MAX_PAGES = 10;
const MAX_DEAL_RELATED_PROJECT_LOOKUPS = 40;
const PORTAL_ID_CACHE_TTL_MS = 10 * 60 * 1000;
const PORTAL_IDS_CACHE_TTL_MS = 10 * 60 * 1000;
const PROJECTS_API_BASE_CACHE_TTL_MS = 60 * 60 * 1000;
const PROJECT_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const PROJECT_MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const DEAL_PROJECT_RELATED_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
const PROJECT_ROUTE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const TASK_STRATEGY_CACHE_TTL_MS = 30 * 60 * 1000;
const CLIENT_PROJECT_LINKS_CACHE_TTL_MS = 3 * 60 * 1000;
const CLIENT_DEALS_CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_PROJECT_MEMBERSHIP_LOOKUPS = 80;
const MAX_TASKLIST_TASK_LOOKUPS = 40;
const MAX_PROJECT_ROUTE_ATTEMPTS = 12;
const KNOWN_PROJECTS_API_BASES = [
	'https://projectsapi.zoho.com',
	'https://projectsapi.zoho.eu',
	'https://projectsapi.zoho.in',
	'https://projectsapi.zoho.com.au',
	'https://projectsapi.zoho.jp',
	'https://projectsapi.zoho.ca',
	'https://projectsapi.zoho.sa',
	'https://projectsapi.zoho.com.cn'
] as const;
const CRM_DEAL_EMAIL_FALLBACK_FIELDS = [
	'Deal_Name',
	'Stage',
	'Created_Time',
	'Modified_Time',
	'Closing_Date',
	'Contact_Name',
	'Zoho_Projects_ID'
].join(',');
const CRM_DEAL_REHYDRATE_BASE_FIELDS = [
	'Deal_Name',
	'Stage',
	'Created_Time',
	'Modified_Time',
	'Closing_Date',
	'Contact_Name',
	'Zoho_Projects_ID'
];
const DEAL_PROJECT_FIELD_CACHE_TTL_MS = 60 * 60 * 1000;

let discoveredPortalIdCache: { portalId: string; base: string; fetchedAt: number } | null = null;
let discoveredProjectsApiBaseCache: { base: string; fetchedAt: number } | null = null;
let dealProjectRelatedListApiNamesCache: { fetchedAt: number; apiNames: string[] } | null = null;
let dealProjectFieldApiNamesCache: { fetchedAt: number; apiNames: string[] } | null = null;
let projectCatalogCache: { fetchedAt: number; projects: any[] } | null = null;
const portalIdsByBaseCache = new Map<string, { fetchedAt: number; portalIds: string[] }>();
const projectRouteByIdCache = new Map<string, { fetchedAt: number; base: string; portalId: string }>();
const membershipProjectIdsByEmailCache = new Map<string, { fetchedAt: number; projectIds: string[] }>();
const taskStrategyCache = new Map<string, { fetchedAt: number; strategyIndex: number }>();
const clientDealsCache = new Map<string, { fetchedAt: number; deals: any[] }>();
const clientDealsInFlightByKey = new Map<string, Promise<any[]>>();
const clientProjectLinksCache = new Map<
	string,
	{ fetchedAt: number; links: ContactProjectLink[] }
>();

function getClientCacheKey(zohoContactId: string | null | undefined, email?: string | null) {
	const contactIdPart = zohoContactId ? String(zohoContactId).trim() : '';
	const emailPart = email ? String(email).trim().toLowerCase() : '';
	return `${contactIdPart}|${emailPart}`;
}

function normalizeProjectsApiBase(value: string) {
	const trimmed = value.trim().replace(/\/$/, '');
	if (!trimmed) return '';
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

function getConfiguredProjectsApiBase() {
	const configured = normalizeProjectsApiBase(env.ZOHO_PROJECTS_API_BASE || '');
	return configured || DEFAULT_PROJECTS_API_BASE;
}

function getProjectsApiBaseCandidates() {
	const candidates = [
		discoveredProjectsApiBaseCache?.base,
		getConfiguredProjectsApiBase(),
		...KNOWN_PROJECTS_API_BASES
	].filter(Boolean) as string[];

	const unique: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const normalized = normalizeProjectsApiBase(candidate);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		unique.push(normalized);
	}
	return unique;
}

function cacheProjectsApiBase(base: string) {
	discoveredProjectsApiBaseCache = {
		base: normalizeProjectsApiBase(base),
		fetchedAt: Date.now()
	};
}

function getProjectsFetchTimeoutMs() {
	const parsed = Number(env.ZOHO_PROJECTS_FETCH_TIMEOUT_MS || '');
	if (Number.isFinite(parsed) && parsed >= 1000) {
		return Math.round(parsed);
	}
	return DEFAULT_PROJECTS_FETCH_TIMEOUT_MS;
}

async function fetchProjectsApiWithTimeout(url: string, init: RequestInit, context: string) {
	const timeoutMs = getProjectsFetchTimeoutMs();
	const controller = new AbortController();
	let detachAbortListener: (() => void) | null = null;
	const externalSignal = init.signal;

	if (externalSignal) {
		if (externalSignal.aborted) {
			controller.abort();
		} else {
			const onAbort = () => controller.abort();
			externalSignal.addEventListener('abort', onAbort, { once: true });
			detachAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
		}
	}

	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new Error(`Zoho Projects API timeout after ${timeoutMs}ms (${context})`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
		detachAbortListener?.();
	}
}

async function fetchPortalsPayload(accessToken: string, base: string) {
	const response = await fetchProjectsApiWithTimeout(
		`${base}/api/v3/portals`,
		{
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
		},
		`list portals (${base})`
	);

	if (response.status === 429) {
		const text = await response.text().catch(() => '');
		log.warn('Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.', {
			status: 429,
			endpoint: '/api/v3/portals',
			base,
			response: text
		});
		throw new Error(`Zoho Projects API error 429: ${text}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Portals API error ${response.status}: ${text}`);
	}

	return response.json();
}

function getPreferredProjectsApiBase() {
	if (
		discoveredProjectsApiBaseCache &&
		Date.now() - discoveredProjectsApiBaseCache.fetchedAt < PROJECTS_API_BASE_CACHE_TTL_MS
	) {
		return discoveredProjectsApiBaseCache.base;
	}
	return getConfiguredProjectsApiBase();
}

function parsePortalIdFromPayload(payload: any) {
	const portalIds = parsePortalIdsFromPayload(payload);
	return portalIds[0] || null;
}

function extractPortalIdFromUrl(value: unknown) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	const match = trimmed.match(/\/portal\/([a-z0-9_-]{3,})/i);
	if (!match?.[1]) return '';
	return match[1].trim();
}

function parsePortalIdsFromPayload(payload: any) {
	const portals = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.portals)
			? payload.portals
			: Array.isArray(payload?.data)
				? payload.data
				: payload?.portal_details && typeof payload.portal_details === 'object'
					? [payload.portal_details]
					: [];
	const portalIds: string[] = [];
	const seen = new Set<string>();
	for (const portal of portals) {
		const directCandidates = [
			portal?.id,
			portal?.portal_id,
			portal?.portalId,
			portal?.zsoid,
			portal?.org_id,
			portal?.organization_id
		];
		for (const candidate of directCandidates) {
			const trimmed = candidate === null || candidate === undefined ? '' : String(candidate).trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			portalIds.push(trimmed);
		}

		const urlCandidates = [
			portal?.link?.project?.url,
			portal?.link?.self?.url,
			portal?.project_url,
			portal?.portal_url,
			portal?.url
		];
		for (const urlCandidate of urlCandidates) {
			const portalIdFromUrl = extractPortalIdFromUrl(urlCandidate);
			if (!portalIdFromUrl || seen.has(portalIdFromUrl)) continue;
			seen.add(portalIdFromUrl);
			portalIds.push(portalIdFromUrl);
		}
	}
	return portalIds;
}

function getCachedPortalIdsForBase(base: string) {
	const cached = portalIdsByBaseCache.get(base);
	if (!cached) return null;
	if (Date.now() - cached.fetchedAt >= PORTAL_IDS_CACHE_TTL_MS) return null;
	return cached.portalIds;
}

async function getPortalIdsForBase(accessToken: string, base: string) {
	const cached = getCachedPortalIdsForBase(base);
	if (cached) return cached;

	const payload = await fetchPortalsPayload(accessToken, base);
	const portalIds = parsePortalIdsFromPayload(payload);
	if (portalIds.length > 0) {
		discoveredPortalIdCache = {
			portalId: portalIds[0],
			base,
			fetchedAt: Date.now()
		};
	}
	portalIdsByBaseCache.set(base, { fetchedAt: Date.now(), portalIds });
	return portalIds;
}

function extractProjectIdFromEndpoint(endpoint: string) {
	const match = endpoint.match(/^\/projects\/([^/?#]+)/i);
	if (!match?.[1]) return '';
	return normalizeCandidateProjectId(match[1]);
}

function cacheProjectRoute(projectId: string, base: string, portalId: string) {
	if (!projectId || !base || !portalId) return;
	projectRouteByIdCache.set(projectId, {
		fetchedAt: Date.now(),
		base,
		portalId
	});
}

function getCachedProjectRoute(projectId: string) {
	if (!projectId) return null;
	const cached = projectRouteByIdCache.get(projectId);
	if (!cached) return null;
	if (Date.now() - cached.fetchedAt >= PROJECT_ROUTE_CACHE_TTL_MS) {
		projectRouteByIdCache.delete(projectId);
		return null;
	}
	return cached;
}

function derivePortalIdCandidatesFromProjectId(projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!/^\d{8,}$/.test(normalizedProjectId)) return [] as string[];

	const candidates: string[] = [];
	const seen = new Set<string>();
	const add = (value: string) => {
		const trimmed = value.trim();
		if (!/^\d{6,12}$/.test(trimmed) || seen.has(trimmed)) return;
		seen.add(trimmed);
		candidates.push(trimmed);
	};

	// Common Zoho pattern: [PORTAL_ID][00000...][ENTITY_ID]
	const prefixed = normalizedProjectId.match(/^(\d{6,12})0{4,}\d+$/);
	if (prefixed?.[1]) add(prefixed[1]);

	for (const length of [7, 8, 9, 10, 11, 12, 6]) {
		if (normalizedProjectId.length <= length) continue;
		add(normalizedProjectId.slice(0, length));
	}

	return candidates;
}

async function getPortalIdCandidatesForBase(accessToken: string, base: string, projectId?: string) {
	const ids: string[] = [];
	const seen = new Set<string>();
	const addId = (value: string | null | undefined) => {
		const id = value ? String(value).trim() : '';
		if (!id || seen.has(id)) return;
		seen.add(id);
		ids.push(id);
	};

	if (projectId) {
		const cachedRoute = getCachedProjectRoute(projectId);
		if (cachedRoute?.base === base) {
			addId(cachedRoute.portalId);
		}
	}

	const configured = (env.ZOHO_PROJECTS_PORTAL_ID || '').trim();
	addId(configured);

	if (
		discoveredPortalIdCache &&
		discoveredPortalIdCache.base === base &&
		Date.now() - discoveredPortalIdCache.fetchedAt < PORTAL_ID_CACHE_TTL_MS
	) {
		addId(discoveredPortalIdCache.portalId);
	}

	if (projectId) {
		for (const derivedId of derivePortalIdCandidatesFromProjectId(projectId)) {
			addId(derivedId);
		}
	}

	try {
		const fetchedIds = await getPortalIdsForBase(accessToken, base);
		for (const id of fetchedIds) addId(id);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('Failed to list portal ids for base candidate', { base, error: message });
	}

	return ids;
}

async function discoverPortalId(accessToken: string) {
	const errors: string[] = [];
	for (const base of getProjectsApiBaseCandidates()) {
		try {
			const portalIds = await getPortalIdsForBase(accessToken, base);
			cacheProjectsApiBase(base);
			const portalId = portalIds[0] || null;
			if (portalId) return portalId;
			errors.push(`${base}: no portals returned`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`${base}: ${message}`);
		}
	}

	throw new Error(`Portals discovery failed across candidate API bases. ${errors.join(' | ')}`);
}

async function resolvePortalId(accessToken: string) {
	const configured = (env.ZOHO_PROJECTS_PORTAL_ID || '').trim();
	if (configured) return configured;

	if (
		discoveredPortalIdCache &&
		Date.now() - discoveredPortalIdCache.fetchedAt < PORTAL_ID_CACHE_TTL_MS
	) {
		return discoveredPortalIdCache.portalId;
	}

	const discovered = await discoverPortalId(accessToken);
	if (discovered) {
		const discoveredBase =
			discoveredPortalIdCache?.portalId === discovered
				? discoveredPortalIdCache.base
				: getPreferredProjectsApiBase();
		discoveredPortalIdCache = {
			portalId: discovered,
			base: discoveredBase,
			fetchedAt: Date.now()
		};
		log.warn(
			'Using auto-discovered Zoho Projects portal ID. Set ZOHO_PROJECTS_PORTAL_ID in env for stable production behavior.',
			{ portalId: discovered, base: discoveredBase }
		);
		return discovered;
	}

	throw new Error(
		'Missing ZOHO_PROJECTS_PORTAL_ID and no portals were auto-discovered. Configure ZOHO_PROJECTS_PORTAL_ID.'
	);
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
		let matchedPreferredKey = false;
		for (const key of preferredKeys) {
			if (record[key] !== undefined) {
				matchedPreferredKey = true;
				parseProjectIdsInternal(record[key], output);
				return;
			}
		}

		if (!matchedPreferredKey) {
			for (const candidate of Object.values(record)) {
				parseProjectIdsInternal(candidate, output);
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
		const normalizedId = normalizeCandidateProjectId(id);
		if (!normalizedId || seen.has(normalizedId)) continue;
		seen.add(normalizedId);
		normalized.push(normalizedId);
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

function getKnownDealProjectFieldApiNames() {
	const names = new Set<string>(['Zoho_Projects_ID']);
	const cached = dealProjectFieldApiNamesCache?.apiNames || [];
	for (const apiName of cached) {
		const normalized = normalizeDealFieldApiName(apiName);
		if (normalized) names.add(normalized);
	}
	return Array.from(names);
}

function collectProjectTextCandidates(value: unknown, output: Set<string>) {
	if (value === null || value === undefined) return;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return;
		const looksLikeProjectId = normalizeCandidateProjectId(trimmed);
		if (!looksLikeProjectId || looksLikeProjectId !== trimmed) {
			output.add(trimmed);
		}
		return;
	}

	if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) collectProjectTextCandidates(item, output);
		return;
	}

	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const preferred = ['name', 'display_value', 'displayValue', 'label', 'value'];
		for (const key of preferred) {
			if (record[key] !== undefined) collectProjectTextCandidates(record[key], output);
		}
	}
}

function getDealProjectNameCandidates(deal: any) {
	const names = new Set<string>();
	for (const apiName of getKnownDealProjectFieldApiNames()) {
		const value = deal?.[apiName];
		if (value === undefined) continue;
		collectProjectTextCandidates(value, names);
	}
	return Array.from(names);
}

function getDealProjectIdsForLinking(deal: any) {
	const projectIds = new Set<string>();
	if (!deal || typeof deal !== 'object') return [] as string[];
	const knownFieldApiNames = getKnownDealProjectFieldApiNames();
	const knownFieldApiNameSet = new Set<string>(knownFieldApiNames);

	for (const apiName of knownFieldApiNames) {
		addProjectIdsFromUnknownValue((deal as any)?.[apiName], projectIds);
	}

	for (const [key, value] of Object.entries(deal as Record<string, unknown>)) {
		if (!key.toLowerCase().includes('project') && !knownFieldApiNameSet.has(key)) continue;
		addProjectIdsFromUnknownValue(value, projectIds);
	}

	return Array.from(projectIds);
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
	const candidates = new Set<string>();
	const dealName = getDealName(deal);
	if (dealName) {
		candidates.add(dealName);
		const stripped = stripTrailingDateSuffix(dealName);
		if (stripped) candidates.add(stripped);
	}
	const contactName = getLookupName(deal?.Contact_Name);
	if (contactName) {
		candidates.add(contactName);
	}
	for (const projectName of getDealProjectNameCandidates(deal)) {
		candidates.add(projectName);
	}
	if (candidates.size === 0) return [];
	return Array.from(candidates)
		.map((name) => normalizeProjectMatchName(name))
		.filter(Boolean);
}

function getDealExactMatchNameCandidates(deal: any) {
	const candidates = new Set<string>();
	const dealName = getDealName(deal);
	if (dealName) candidates.add(dealName);
	for (const projectName of getDealProjectNameCandidates(deal)) {
		candidates.add(projectName);
	}
	return Array.from(candidates)
		.map((name) => normalizeProjectMatchName(name))
		.filter(Boolean);
}

function buildExactProjectNameIndex(projects: any[]) {
	const index = new Map<string, string[]>();
	for (const project of projects || []) {
		const projectId = getProjectId(project);
		const projectName = getProjectName(project);
		if (!projectId || !projectName) continue;
		const key = normalizeProjectMatchName(projectName);
		if (!key) continue;
		const existing = index.get(key) || [];
		if (!existing.includes(projectId)) existing.push(projectId);
		index.set(key, existing);
	}
	return index;
}

function toTimestamp(value: unknown) {
	if (typeof value !== 'string') return 0;
	const parsed = new Date(value);
	return Number.isFinite(parsed.valueOf()) ? parsed.valueOf() : 0;
}

function getDealSortTimestamp(deal: any) {
	return Math.max(
		toTimestamp(deal?.Modified_Time),
		toTimestamp(deal?.Created_Time),
		toTimestamp(deal?.Closing_Date)
	);
}

function sortDealsForProjectMatching(deals: any[]) {
	return [...(deals || [])].sort((left, right) => {
		const leftActive = isPortalActiveStage(typeof left?.Stage === 'string' ? left.Stage : null) ? 1 : 0;
		const rightActive = isPortalActiveStage(typeof right?.Stage === 'string' ? right.Stage : null) ? 1 : 0;
		if (leftActive !== rightActive) return rightActive - leftActive;

		const leftTime = getDealSortTimestamp(left);
		const rightTime = getDealSortTimestamp(right);
		if (leftTime !== rightTime) return rightTime - leftTime;

		const leftName = (getDealName(left) || '').toLowerCase();
		const rightName = (getDealName(right) || '').toLowerCase();
		return leftName.localeCompare(rightName);
	});
}

function normalizeRelatedListApiName(value: unknown) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return trimmed || '';
}

function containsProjectText(value: unknown) {
	if (typeof value !== 'string') return false;
	return value.toLowerCase().includes('project');
}

function normalizeDealFieldApiName(value: unknown) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return trimmed || '';
}

function isProjectDealField(field: any) {
	if (!field || typeof field !== 'object') return false;
	return (
		containsProjectText(field?.api_name) ||
		containsProjectText(field?.field_label) ||
		containsProjectText(field?.data_type) ||
		containsProjectText(field?.lookup?.module)
	);
}

async function getDealProjectFieldApiNames(accessToken: string) {
	if (
		dealProjectFieldApiNamesCache &&
		Date.now() - dealProjectFieldApiNamesCache.fetchedAt < DEAL_PROJECT_FIELD_CACHE_TTL_MS
	) {
		return dealProjectFieldApiNamesCache.apiNames;
	}

	const defaults = ['Zoho_Projects_ID'];
	const discovered: string[] = [];
	try {
		const payload = await zohoApiCall(accessToken, '/settings/fields?module=Deals');
		const fields = Array.isArray(payload?.fields)
			? payload.fields
			: Array.isArray(payload?.data)
				? payload.data
				: [];
		for (const field of fields) {
			if (!isProjectDealField(field)) continue;
			const apiName = normalizeDealFieldApiName(field?.api_name);
			if (apiName) discovered.push(apiName);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('Failed to discover Deals project field API names', { error: message });
	}

	const uniqueApiNames: string[] = [];
	const seen = new Set<string>();
	for (const apiName of [...defaults, ...discovered]) {
		const normalized = normalizeDealFieldApiName(apiName);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		uniqueApiNames.push(normalized);
	}

	dealProjectFieldApiNamesCache = { fetchedAt: Date.now(), apiNames: uniqueApiNames };
	return uniqueApiNames;
}

function pickRelatedListsArray(payload: any) {
	if (Array.isArray(payload?.related_lists)) return payload.related_lists;
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

function isProjectsRelatedList(record: any) {
	if (!record || typeof record !== 'object') return false;
	const candidates = [record.api_name, record.display_label, record.plural_label, record.module, record.name];
	return candidates.some((candidate) => {
		if (typeof candidate !== 'string') return false;
		return candidate.toLowerCase().includes('project');
	});
}

async function getDealProjectRelatedListApiNames(accessToken: string) {
	if (
		dealProjectRelatedListApiNamesCache &&
		Date.now() - dealProjectRelatedListApiNamesCache.fetchedAt < DEAL_PROJECT_RELATED_LIST_CACHE_TTL_MS
	) {
		return dealProjectRelatedListApiNamesCache.apiNames;
	}

	const defaults = ['Projects', 'Zoho_Projects'];
	const discovered: string[] = [];
	try {
		const payload = await zohoApiCall(accessToken, '/settings/related_lists?module=Deals');
		const relatedLists = pickRelatedListsArray(payload);
		for (const relatedList of relatedLists) {
			if (!isProjectsRelatedList(relatedList)) continue;
			const apiName = normalizeRelatedListApiName(relatedList?.api_name ?? relatedList?.name);
			if (apiName) discovered.push(apiName);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('Failed to discover Deals related lists for project mapping', { error: message });
	}

	const uniqueApiNames: string[] = [];
	const seen = new Set<string>();
	for (const apiName of [...defaults, ...discovered]) {
		const normalized = normalizeRelatedListApiName(apiName);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		uniqueApiNames.push(normalized);
	}

	dealProjectRelatedListApiNamesCache = {
		fetchedAt: Date.now(),
		apiNames: uniqueApiNames
	};
	return uniqueApiNames;
}

function normalizeCandidateProjectId(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';

	// Direct ID token (Zoho projects IDs are usually long numeric strings, but some orgs
	// persist identifiers with prefixes/suffixes or as URL fragments).
	if (/^[a-z0-9_-]{6,}$/i.test(trimmed)) return trimmed;

	const fromProjectPath = trimmed.match(/\/projects?\/([a-z0-9_-]{6,})/i);
	if (fromProjectPath?.[1]) return fromProjectPath[1];

	const fromProjectParam = trimmed.match(
		/(?:^|[?&#])(?:project(?:_id|id)?|proj(?:ect)?id)=([a-z0-9_-]{6,})/i
	);
	if (fromProjectParam?.[1]) return fromProjectParam[1];

	const digitRuns = trimmed.match(/\d{6,}/g) || [];
	if (digitRuns.length === 1) return digitRuns[0] ?? '';
	if (/project/i.test(trimmed) && digitRuns.length > 1) return digitRuns[0] ?? '';

	return '';
}

function addProjectIdsFromUnknownValue(value: unknown, output: Set<string>) {
	const parsedIds = parseZohoProjectIds(value);
	for (const parsedId of parsedIds) {
		const normalizedId = normalizeCandidateProjectId(parsedId);
		if (!normalizedId) continue;
		output.add(normalizedId);
	}
}

function extractProjectIdsFromRelatedRecord(record: any) {
	const projectIds = new Set<string>();
	if (!record || typeof record !== 'object') return [] as string[];

	for (const [key, value] of Object.entries(record)) {
		if (!key.toLowerCase().includes('project')) continue;
		addProjectIdsFromUnknownValue(value, projectIds);
	}

	// For a true "Projects" related list, the row id is often the project id.
	if (projectIds.size === 0) {
		addProjectIdsFromUnknownValue(record.id, projectIds);
	}

	return Array.from(projectIds);
}

async function getProjectIdsFromDealRelatedLists(accessToken: string, dealId: string, relatedListApiNames: string[]) {
	const projectIds = new Set<string>();
	const candidateApiNames = relatedListApiNames
		.map((value) => normalizeRelatedListApiName(value))
		.filter(Boolean);

	for (const apiName of candidateApiNames) {
		try {
			for (let page = 1; page <= CRM_RELATED_LIST_MAX_PAGES; page += 1) {
				const payload = await zohoApiCall(
					accessToken,
					`/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(apiName)}?per_page=${CRM_RELATED_LIST_PAGE_SIZE}&page=${page}`
				);
				const rows = pickCrmArray(payload, apiName);
				if (rows.length === 0) break;

				for (const row of rows) {
					const ids = extractProjectIdsFromRelatedRecord(row);
					for (const id of ids) projectIds.add(id);
				}

				if (!hasMorePages(payload, rows.length, CRM_RELATED_LIST_PAGE_SIZE)) break;
			}
		} catch {
			// Continue; related list names can vary by org and customizations.
		}
	}

	return Array.from(projectIds);
}

function getMatchTokens(value: string) {
	return value
		.split(' ')
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);
}

function countTokenOverlap(left: string, right: string) {
	const leftTokens = new Set(getMatchTokens(left));
	const rightTokens = new Set(getMatchTokens(right));
	let overlap = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) overlap += 1;
	}
	return overlap;
}

function scoreProjectNameMatch(dealCandidate: string, projectName: string) {
	if (!dealCandidate || !projectName) return 0;
	if (dealCandidate === projectName) return 100;
	if (projectName.startsWith(dealCandidate) && dealCandidate.length >= 8) return 90;
	if (dealCandidate.startsWith(projectName) && projectName.length >= 8) return 88;
	if (projectName.includes(dealCandidate) && dealCandidate.length >= 10) return 84;

	const overlap = countTokenOverlap(dealCandidate, projectName);
	if (overlap >= 3) return 86;
	if (overlap >= 2) return 83;
	if (overlap >= 1) return 80;

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
	if (best.score < 80) return null;
	// Allow high-confidence matches even when duplicates exist (for example, an archived
	// copy of the same project name). Keep the ambiguity suppression only for near-equal scores.
	if (secondBestScore >= 80 && best.score - secondBestScore < 5) return null;

	return best;
}

type ContactProjectLink = {
	projectId: string;
	portalId: string;
	base: string;
	source: 'crm_deal_field' | 'crm_related_list' | 'projects_membership';
};

async function getContactProjectLinks(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string,
	opts: {
		signal?: AbortSignal;
		skipMembershipLookup?: boolean;
	}
): Promise<ContactProjectLink[]> {
	const cacheKey = getClientCacheKey(zohoContactId, email);
	const cached = clientProjectLinksCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CLIENT_PROJECT_LINKS_CACHE_TTL_MS) {
		return cached.links;
	}

	const deals = await getClientDeals(accessToken, zohoContactId, email);
	const fieldApiNames = await getDealProjectFieldApiNames(accessToken);
	const relatedListApiNames = await getDealProjectRelatedListApiNames(accessToken);

	const sortedDeals = sortDealsForProjectMatching(deals);

	const links: ContactProjectLink[] = [];
	const seenProjectIds = new Set<string>();
	const addLink = (link: ContactProjectLink) => {
		if (seenProjectIds.has(link.projectId)) return;
		seenProjectIds.add(link.projectId);
		links.push(link);
	};

	const base = getPreferredProjectsApiBase();
	const portalId = await resolvePortalId(accessToken);

	for (const deal of sortedDeals) {
		const dealId = deal?.id ? String(deal.id) : null;
		if (!dealId) continue;

		// 1. Check for project IDs in deal fields
		const dealProjectIds = getDealProjectIdsForLinking(deal);
		for (const projectId of dealProjectIds) {
			addLink({ projectId, portalId, base, source: 'crm_deal_field' });
		}

		// 2. Check deal's related lists for project IDs (limited to configured max)
		if (links.length < MAX_DEAL_RELATED_PROJECT_LOOKUPS) {
			const relatedProjectIds = await getProjectIdsFromDealRelatedLists(
				accessToken,
				dealId,
				relatedListApiNames
			);
			for (const projectId of relatedProjectIds) {
				addLink({ projectId, portalId, base, source: 'crm_related_list' });
			}
		}
	}

	if (!opts.skipMembershipLookup) {
		const membershipProjectIds = await getMembershipProjectIds(accessToken, email, opts.signal);
		for (const projectId of membershipProjectIds) {
			addLink({ projectId, portalId, base, source: 'projects_membership' });
		}
	}

	clientProjectLinksCache.set(cacheKey, { fetchedAt: Date.now(), links });
	return links;
}

async function getClientDeals(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string
): Promise<any[]> {
	const cacheKey = getClientCacheKey(zohoContactId, email);

	const cached = clientDealsCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CLIENT_DEALS_CACHE_TTL_MS) {
		return cached.deals;
	}

	const inFlight = clientDealsInFlightByKey.get(cacheKey);
	if (inFlight) return inFlight;

	const promise = (async () => {
		try {
			const deals = await getContactDeals(accessToken, zohoContactId, email);
			clientDealsCache.set(cacheKey, { fetchedAt: Date.now(), deals });
			return deals;
		} finally {
			clientDealsInFlightByKey.delete(cacheKey);
		}
	})();

	clientDealsInFlightByKey.set(cacheKey, promise);
	return promise;
}

async function getMembershipProjectIds(
	accessToken: string,
	email: string,
	signal?: AbortSignal
): Promise<string[]> {
	const cached = membershipProjectIdsByEmailCache.get(email);
	if (cached && Date.now() - cached.fetchedAt < PROJECT_MEMBERSHIP_CACHE_TTL_MS) {
		return cached.projectIds;
	}

	const fetchedProjectIds = await fetchMembershipProjectIds(accessToken, email, signal);
	membershipProjectIdsByEmailCache.set(email, { fetchedAt: Date.now(), projectIds: fetchedProjectIds });
	return fetchedProjectIds;
}

async function fetchMembershipProjectIds(
	accessToken: string,
	email: string,
	signal?: AbortSignal
): Promise<string[]> {
	const projects = await fetchAllProjects(accessToken, signal);

	if (projects.length === 0) return [];

	const projectIds: string[] = [];
	const seenIds = new Set<string>();
	let lookups = 0;

	for (const project of projects) {
		if (lookups >= MAX_PROJECT_MEMBERSHIP_LOOKUPS) break;
		const projectId = getProjectId(project);
		if (!projectId || seenIds.has(projectId)) continue;
		seenIds.add(projectId);

		try {
			lookups += 1;
			const isMember = await checkProjectMembership(accessToken, projectId, email, signal);
			if (isMember) projectIds.push(projectId);
		} catch (err) {
			if (signal?.aborted) break;
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Project membership check failed', { projectId, email, error: message });
		}
	}

	return projectIds;
}

async function fetchAllProjects(accessToken: string, signal?: AbortSignal): Promise<any[]> {
	if (
		projectCatalogCache &&
		Date.now() - projectCatalogCache.fetchedAt < PROJECT_CATALOG_CACHE_TTL_MS
	) {
		return projectCatalogCache.projects;
	}

	const allProjects: any[] = [];

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		if (signal?.aborted) break;

		try {
			const payload = await projectsApiCall(
				`/projects/?page=${page}&page_size=${DEFAULT_PAGE_SIZE}`,
				{ signal }
			);
			const projects = Array.isArray(payload?.projects) ? payload.projects : [];
			allProjects.push(...projects);
			if (projects.length < DEFAULT_PAGE_SIZE) break;
		} catch (err) {
			if (signal?.aborted) break;
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to fetch projects page', { page, error: message });
			break;
		}
	}

	projectCatalogCache = { fetchedAt: Date.now(), projects: allProjects };
	return allProjects;
}

async function checkProjectMembership(
	accessToken: string,
	projectId: string,
	email: string,
	signal?: AbortSignal
): Promise<boolean> {
	const normalizedEmail = email.trim().toLowerCase();

	const payload = await projectsApiCall(`/projects/${projectId}/users/`, { signal });
	const users = Array.isArray(payload?.users) ? payload.users : [];

	return users.some((user: any) => {
		const userEmail = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
		return userEmail === normalizedEmail;
	});
}

export async function getProjectDetails(
	accessToken: string,
	projectId: string
): Promise<{ id: string; name: string } | null> {
	try {
		const payload = await projectsApiCall(`/projects/${projectId}/`);
		const project = Array.isArray(payload?.projects) ? payload.projects[0] : null;
		if (!project?.id || !project?.name) return null;
		return { id: String(project.id), name: String(project.name) };
	} catch {
		return null;
	}
}

export async function getClientProjects(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string,
	opts: { signal?: AbortSignal; skipMembershipLookup?: boolean } = {}
): Promise<{ id: string; name: string }[]> {
	const links = await getContactProjectLinks(accessToken, zohoContactId, email, opts);

	if (links.length === 0) return [];

	const results: { id: string; name: string }[] = [];
	const seenIds = new Set<string>();

	// Try to get all projects from cache first
	const allProjects = await fetchAllProjects(accessToken, opts.signal);
	const projectIndex = new Map<string, any>();
	for (const project of allProjects) {
		const id = getProjectId(project);
		if (id) projectIndex.set(id, project);
	}

	for (const link of links) {
		if (seenIds.has(link.projectId)) continue;
		seenIds.add(link.projectId);

		// Check if we have it in the project index
		const cachedProject = projectIndex.get(link.projectId);
		if (cachedProject) {
			const id = getProjectId(cachedProject);
			const name = getProjectName(cachedProject);
			if (id && name) {
				results.push({ id, name });
				continue;
			}
		}

		const details = await getProjectDetails(accessToken, link.projectId);
		if (details) {
			results.push(details);
		}
	}

	return results;
}

export async function resolveClientProjectByDealName(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string,
	dealName: string,
	opts: { signal?: AbortSignal } = {}
): Promise<{ id: string; name: string } | null> {
	const deals = await getClientDeals(accessToken, zohoContactId, email);
	const matchingDeal = deals.find(
		(deal) => getDealName(deal)?.toLowerCase() === dealName.toLowerCase()
	);

	if (!matchingDeal) return null;

	// Build a list of all projects
	const allProjects = await fetchAllProjects(accessToken, opts.signal);
	
	// First try to match by deal name against project names
	const dealCandidates = getDealExactMatchNameCandidates(matchingDeal);
	const exactNameIndex = buildExactProjectNameIndex(allProjects);
	
	for (const candidate of dealCandidates) {
		const matchingProjectIds = exactNameIndex.get(candidate);
		if (matchingProjectIds && matchingProjectIds.length === 1) {
			const projectId = matchingProjectIds[0];
			if (!projectId) continue;
			const details = await getProjectDetails(accessToken, projectId);
			if (details) return details;
		}
	}
	
	// Then check CRM fields and related lists as fallback
	const links = await getContactProjectLinks(accessToken, zohoContactId, email, opts);
	const linkProjectIds = links.map((l) => l.projectId);
	
	for (const projectId of linkProjectIds) {
		const details = await getProjectDetails(accessToken, projectId);
		if (!details) continue;
		
		const projectNameNormalized = normalizeProjectMatchName(details.name);
		for (const candidate of dealCandidates) {
			if (scoreProjectNameMatch(candidate, projectNameNormalized) >= 80) {
				return details;
			}
		}
	}
	
	return null;
}

export async function resolveClientProjectsFromDeals(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string,
	opts: { signal?: AbortSignal } = {}
): Promise<{ id: string; name: string }[]> {
	const deals = await getClientDeals(accessToken, zohoContactId, email);

	if (deals.length === 0) return [];

	const allProjects = await fetchAllProjects(accessToken, opts.signal);
	if (allProjects.length === 0) return [];

	const exactNameIndex = buildExactProjectNameIndex(allProjects);
	const sortedDeals = sortDealsForProjectMatching(deals);

	const results: { id: string; name: string }[] = [];
	const usedProjectIds = new Set<string>();
	const seenResultProjectIds = new Set<string>();

	for (const deal of sortedDeals) {
		if (results.length >= MAX_DEAL_RELATED_PROJECT_LOOKUPS) break;

		const dealCandidates = getDealExactMatchNameCandidates(deal);

		let projectId: string | null = null;

		// Try exact name match first
		for (const candidate of dealCandidates) {
			const matchingProjectIds = exactNameIndex.get(candidate);
			if (matchingProjectIds && matchingProjectIds.length === 1) {
				const candidateId = matchingProjectIds[0];
				if (candidateId && !usedProjectIds.has(candidateId)) {
					projectId = candidateId;
					break;
				}
			}
		}

		// Fall back to fuzzy match
		if (!projectId) {
			const bestMatch = findBestProjectMatchForDeal(deal, allProjects, usedProjectIds);
			if (bestMatch) projectId = bestMatch.projectId;
		}

		if (!projectId) continue;

		const project = allProjects.find((p) => getProjectId(p) === projectId);
		const projectName = project ? getProjectName(project) : null;

		if (projectId && projectName && !seenResultProjectIds.has(projectId)) {
			seenResultProjectIds.add(projectId);
			usedProjectIds.add(projectId);
			results.push({ id: projectId, name: projectName });
		}
	}

	return results;
}

type ProjectsApiCallOptions = RequestInit & { signal?: AbortSignal };

async function projectsApiCall(endpoint: string, init: ProjectsApiCallOptions = {}) {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho tokens not configured');

	let accessToken = tokens.access_token;
	const projectId = extractProjectIdFromEndpoint(endpoint);

	const baseCandidates = getProjectsApiBaseCandidates();

	for (let attempt = 0; attempt < MAX_PROJECT_ROUTE_ATTEMPTS; attempt += 1) {
		const base = baseCandidates[attempt % baseCandidates.length];
		if (!base) continue;

		const portalIdCandidates = await getPortalIdCandidatesForBase(accessToken, base, projectId || undefined);

		for (const portalId of portalIdCandidates) {
			const url = `${base}/api/v3/portal/${portalId}${endpoint}`;
			try {
				const response = await fetchProjectsApiWithTimeout(
					url,
					{
						...init,
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Zoho-oauthtoken ${accessToken}`,
							...(init.headers as Record<string, string> | undefined)
						}
					},
					`${init.method || 'GET'} ${endpoint}`
				);

				if (response.status === 401) {
					try {
						const refreshed = await refreshAccessToken(tokens.refresh_token);
						if (refreshed?.access_token) {
							accessToken = refreshed.access_token;
							await upsertZohoTokens({
								...tokens,
								access_token: refreshed.access_token
							});
						}
					} catch {
						// ignore token refresh errors, continue with next candidate
					}
					continue;
				}

				if (response.status === 404) {
					continue;
				}

				if (response.status === 429) {
					const text = await response.text().catch(() => '');
					log.warn('Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.', {
						status: 429,
						endpoint,
						base,
						portalId,
						response: text
					});
					throw new Error(`Zoho Projects API error 429: ${text}`);
				}

				if (!response.ok) {
					const text = await response.text().catch(() => '');
					throw new Error(`Projects API error ${response.status} at ${url}: ${text}`);
				}

				cacheProjectsApiBase(base);
				if (projectId) cacheProjectRoute(projectId, base, portalId);

				return response.json();
			} catch (err) {
				if (
					err instanceof Error &&
					(err.message.includes('timeout') || err.message.includes('429'))
				) {
					throw err;
				}
			}
		}
	}

	throw new Error(`Zoho Projects API: all route candidates exhausted for ${endpoint}`);
}

function hasMorePages(payload: any, count: number, pageSize: number) {
	const info = payload?.page_context ?? payload?.pageContext ?? payload?.pagination ?? null;
	if (info && typeof info === 'object') {
		if (info.has_more_page === false || info.hasMorePage === false) return false;
		if (info.has_more_page === true || info.hasMorePage === true) return true;
	}
	return count >= pageSize;
}

function pickCrmArray(payload: any, key?: string) {
	if (Array.isArray(payload)) return payload;
	if (key && Array.isArray(payload?.[key])) return payload[key];
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

export async function createZohoProject(data: {
	name: string;
	description?: string;
	start_date?: string;
	end_date?: string;
}): Promise<{ id: string; name: string }> {
	try {
		console.log('[createZohoProject] calling /projects/ with body:', JSON.stringify({ projects: [data] }).substring(0, 200));
		const payload = await projectsApiCall('/projects/', {
			method: 'POST',
			body: JSON.stringify({ projects: [data] })
		});
		const project = payload?.id ? payload : (Array.isArray(payload?.projects) ? payload.projects[0] : null);
		if (!project?.id || !project?.name) {
			throw new Error('response missing created project');
		}
		if (discoveredPortalIdCache) {
			cacheProjectRoute(String(project.id), discoveredPortalIdCache.base, discoveredPortalIdCache.portalId);
		}
		return {
			id: String(project.id),
			name: String(project.name)
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Zoho Projects create project failed: ${message}`);
	}
}

/**
 * Create a Zoho Projects milestone for a project.
 */
export async function createZohoMilestone(data: {
	projectId: string;
	name: string;
	end_date: string;
	status?: string;
	flag?: string;
}): Promise<{ id: string; name: string }> {
	const { projectId, ...milestoneData } = data;
	try {
		const payload = await projectsApiCall(`/projects/${projectId}/phases`, {
			method: 'POST',
			body: JSON.stringify(milestoneData)
		});
		const milestone = payload?.id
			? payload
			: Array.isArray(payload?.milestones)
				? payload.milestones[0]
				: null;
		if (!milestone?.id || !milestone?.name) {
			throw new Error('response missing created milestone');
		}
		return { id: String(milestone.id), name: String(milestone.name) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Zoho Projects create milestone failed: ${message}`);
	}
}

/**
 * Create a Zoho Projects task list for a project.
 */
export async function createZohoTaskList(data: {
	projectId: string;
	name: string;
	milestone_id?: string;
}): Promise<{ id: string; name: string }> {
	const { projectId, ...taskListData } = data;
	try {
		const payload = await projectsApiCall(`/projects/${projectId}/tasklists`, {
			method: 'POST',
			body: JSON.stringify(taskListData)
		});
		const taskList = payload?.id
			? payload
			: Array.isArray(payload?.tasklists)
				? payload.tasklists[0]
				: null;
		if (!taskList?.id || !taskList?.name) {
			throw new Error('response missing created task list');
		}
		return { id: String(taskList.id), name: String(taskList.name) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Zoho Projects create task list failed: ${message}`);
	}
}

/**
 * Create a Zoho Projects task.
 */
export async function createZohoTask(data: {
	projectId: string;
	tasklistId: string;
	name: string;
	description?: string;
	due_date?: string;
	status?: string;
}): Promise<{ id: string; name: string }> {
	const { projectId, tasklistId, ...taskData } = data;
	try {
		const payload = await projectsApiCall(`/projects/${projectId}/tasklists/${tasklistId}/tasks`, {
			method: 'POST',
			body: JSON.stringify(taskData)
		});
		const task = payload?.id
			? payload
			: Array.isArray(payload?.tasks)
				? payload.tasks[0]
				: null;
		if (!task?.id || !task?.name) {
			throw new Error('response missing created task');
		}
		return { id: String(task.id), name: String(task.name) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Zoho Projects create task failed: ${message}`);
	}
}

/**
 * Update a Zoho Projects task status.
 */
export async function updateZohoTaskStatus(data: {
	projectId: string;
	taskId: string;
	status: string;
}): Promise<{ id: string; name: string; status: string }> {
	const { projectId, taskId, status } = data;
	try {
		const payload = await projectsApiCall(`/projects/${projectId}/tasks/${taskId}`, {
			method: 'PUT',
			body: JSON.stringify({ status })
		});
		const task = payload?.id
			? payload
			: Array.isArray(payload?.tasks)
				? payload.tasks[0]
				: null;
		if (!task?.id || !task?.name) {
			throw new Error('response missing updated task');
		}
		return {
			id: String(task.id),
			name: String(task.name || ''),
			status: String(task.status?.name || task.custom_status || task.status || status)
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Zoho Projects update task status failed: ${message}`);
	}
}

/**
 * Pause async execution for a number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
