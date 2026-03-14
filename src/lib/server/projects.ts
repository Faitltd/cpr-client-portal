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
	// copy of the same project name). Keep the ambiguity guard only for borderline scores.
	if (best.score < 90 && secondBestScore >= 80) return null;

	return best;
}

function hasMorePages(payload: any, pageItemCount: number, pageSize: number) {
	if (pageItemCount < pageSize) return false;
	const moreRecords = payload?.info?.more_records ?? payload?.page_context?.has_more_page;
	if (typeof moreRecords === 'boolean') return moreRecords;
	return pageItemCount >= pageSize;
}

function pickCrmArray(payload: any, key?: string): any[] {
	if (!payload) return [];
	if (key && Array.isArray(payload[key])) return payload[key];
	if (Array.isArray(payload.data)) return payload.data;
	if (Array.isArray(payload)) return payload;
	return [];
}

export interface ContactProjectLink {
	contactId: string;
	projectId: string;
	dealId?: string;
	dealName?: string;
	stage?: string;
	matchSource: 'project_id_field' | 'related_list' | 'name_match';
}

type ProjectsApiEndpoint = `/portal/${string}/projects/${string}${string}`;
function buildProjectsApiEndpoint(
	portalId: string,
	projectId: string,
	suffix: string
): ProjectsApiEndpoint {
	return `/portal/${portalId}/projects/${projectId}${suffix}`;
}

async function callProjectsApi(
	accessToken: string,
	base: string,
	endpoint: string,
	init?: RequestInit
) {
	const url = `${base}/api/v3${endpoint}`;
	const response = await fetchProjectsApiWithTimeout(
		url,
		{
			...init,
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				...(init?.headers ?? {})
			}
		},
		endpoint
	);

	if (response.status === 429) {
		const text = await response.text().catch(() => '');
		log.warn('Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.', {
			status: 429,
			endpoint,
			base,
			response: text
		});
		throw new Error(`Zoho Projects API error 429: ${text}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Zoho Projects API error ${response.status}: ${text}`);
	}

	return response.json();
}

type RoutedProjectsApiCall = (endpoint: string, init?: RequestInit) => Promise<any>;

async function withProjectRoute(
	accessToken: string,
	projectId: string,
	callback: (call: RoutedProjectsApiCall, base: string, portalId: string) => Promise<any>
): Promise<any> {
	const cachedRoute = getCachedProjectRoute(projectId);

	if (cachedRoute) {
		try {
			return await callback(
				(endpoint, init) => callProjectsApi(accessToken, cachedRoute.base, endpoint, init),
				cachedRoute.base,
				cachedRoute.portalId
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!message.includes('404') && !message.includes('403')) throw err;
			// Fall through to rediscover route.
		}
	}

	const baseCandidates = getProjectsApiBaseCandidates();
	const errors: string[] = [];
	let attempts = 0;

	for (const base of baseCandidates) {
		const portalIdCandidates = await getPortalIdCandidatesForBase(accessToken, base, projectId);

		for (const portalId of portalIdCandidates) {
			if (attempts >= MAX_PROJECT_ROUTE_ATTEMPTS) break;
			attempts += 1;

			try {
				const result = await callback(
					(endpoint, init) => callProjectsApi(accessToken, base, endpoint, init),
					base,
					portalId
				);
				cacheProjectsApiBase(base);
				cacheProjectRoute(projectId, base, portalId);
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (!message.includes('404') && !message.includes('403')) {
					cacheProjectsApiBase(base);
					throw err;
				}
				errors.push(`${base}/${portalId}: ${message}`);
			}
		}

		if (attempts >= MAX_PROJECT_ROUTE_ATTEMPTS) break;
	}

	throw new Error(
		`Project route not found for projectId=${projectId} after ${attempts} attempts. Errors: ${errors.join(' | ')}`
	);
}

async function withPortalRoute(
	accessToken: string,
	callback: (call: RoutedProjectsApiCall, base: string, portalId: string) => Promise<any>
): Promise<any> {
	const preferredBase = getPreferredProjectsApiBase();
	const baseCandidates = [
		preferredBase,
		...getProjectsApiBaseCandidates().filter((b) => b !== preferredBase)
	];

	const errors: string[] = [];
	for (const base of baseCandidates) {
		const portalIdCandidates = await getPortalIdCandidatesForBase(accessToken, base);

		for (const portalId of portalIdCandidates) {
			try {
				const result = await callback(
					(endpoint, init) => callProjectsApi(accessToken, base, endpoint, init),
					base,
					portalId
				);
				cacheProjectsApiBase(base);
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (!message.includes('404') && !message.includes('403')) throw err;
				errors.push(`${base}/${portalId}: ${message}`);
			}
		}
	}

	throw new Error(`Portal route not found. Errors: ${errors.join(' | ')}`);
}

export async function listPortals(accessToken: string) {
	const baseCandidates = getProjectsApiBaseCandidates();
	const results: { portalId: string; base: string }[] = [];
	const seenPortalIds = new Set<string>();

	for (const base of baseCandidates) {
		try {
			const portalIds = await getPortalIdsForBase(accessToken, base);
			for (const portalId of portalIds) {
				if (!seenPortalIds.has(portalId)) {
					seenPortalIds.add(portalId);
					results.push({ portalId, base });
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('listPortals: failed to get portal IDs for base', { base, error: message });
		}
	}

	return results;
}

export async function getProjectCatalog(accessToken: string) {
	if (
		projectCatalogCache &&
		Date.now() - projectCatalogCache.fetchedAt < PROJECT_CATALOG_CACHE_TTL_MS
	) {
		return projectCatalogCache.projects;
	}

	const portalId = await resolvePortalId(accessToken);
	const preferredBase = getPreferredProjectsApiBase();
	const allProjects: any[] = [];

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const payload = await callProjectsApi(
			accessToken,
			preferredBase,
			`/portal/${portalId}/projects/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}&status=all`
		);
		const projects = Array.isArray(payload?.projects) ? payload.projects : [];
		allProjects.push(...projects);
		if (projects.length < DEFAULT_PAGE_SIZE) break;
	}

	projectCatalogCache = { fetchedAt: Date.now(), projects: allProjects };
	return allProjects;
}

export async function getProject(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const payload = await call(
			buildProjectsApiEndpoint(portalId, normalizedProjectId, '')
		);
		const projects = Array.isArray(payload?.projects) ? payload.projects : [];
		return projects[0] ?? null;
	});
}

export async function createZohoProject(
	accessToken: string,
	data: {
		name: string;
		description?: string;
		startDate?: string;
		endDate?: string;
		[key: string]: unknown;
	}
) {
	const portalId = await resolvePortalId(accessToken);
	const preferredBase = getPreferredProjectsApiBase();

	log.debug('createZohoProject: request', {
		base: preferredBase,
		portalId,
		data
	});

	const payload = await callProjectsApi(
		accessToken,
		preferredBase,
		`/portal/${portalId}/projects/`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projects: [data] })
		}
	);

	log.debug('createZohoProject: response', { payload });

	const projects = Array.isArray(payload?.projects) ? payload.projects : [];
	return projects[0] ?? null;
}

export async function createZohoPhase(
	accessToken: string,
	projectId: string,
	data: {
		name: string;
		startDate: string;
		endDate: string;
		[key: string]: unknown;
	}
) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const payload = await call(
			buildProjectsApiEndpoint(portalId, normalizedProjectId, '/phases/'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			}
		);
		return payload;
	});
}

export async function createZohoTasklist(
	accessToken: string,
	projectId: string,
	data: {
		name: string;
		[key: string]: unknown;
	}
) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const payload = await call(
			buildProjectsApiEndpoint(portalId, normalizedProjectId, '/tasklists/'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			}
		);
		return payload;
	});
}

export async function getTasklists(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const allTasklists: any[] = [];
		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const payload = await call(
				buildProjectsApiEndpoint(
					portalId,
					normalizedProjectId,
					`/tasklists/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}`
				)
			);
			const tasklists = Array.isArray(payload?.tasklists) ? payload.tasklists : [];
			allTasklists.push(...tasklists);
			if (tasklists.length < DEFAULT_PAGE_SIZE) break;
		}
		return allTasklists;
	});
}

export async function getTasksForTasklist(
	accessToken: string,
	projectId: string,
	tasklistId: string
) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const allTasks: any[] = [];
		for (let page = 1; page <= MAX_TASKLIST_TASK_LOOKUPS; page += 1) {
			const payload = await call(
				buildProjectsApiEndpoint(
					portalId,
					normalizedProjectId,
					`/tasklists/${encodeURIComponent(tasklistId)}/tasks/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}`
				)
			);
			const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
			allTasks.push(...tasks);
			if (tasks.length < DEFAULT_PAGE_SIZE) break;
		}
		return allTasks;
	});
}

export async function getProjectMilestones(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const allMilestones: any[] = [];
		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const payload = await call(
				buildProjectsApiEndpoint(
					portalId,
					normalizedProjectId,
					`/milestones/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}`
				)
			);
			const milestones = Array.isArray(payload?.milestones) ? payload.milestones : [];
			allMilestones.push(...milestones);
			if (milestones.length < DEFAULT_PAGE_SIZE) break;
		}
		return allMilestones;
	});
}

export async function getProjectStatuses(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const payload = await call(
			buildProjectsApiEndpoint(portalId, normalizedProjectId, '/statuses/')
		);
		return Array.isArray(payload?.statuses) ? payload.statuses : [];
	});
}

export async function getProjectActivities(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) throw new Error(`Invalid project ID: ${projectId}`);

	return withProjectRoute(accessToken, normalizedProjectId, async (call, _base, portalId) => {
		const allActivities: any[] = [];
		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const payload = await call(
				buildProjectsApiEndpoint(
					portalId,
					normalizedProjectId,
					`/activities/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}`
				)
			);
			const activities = Array.isArray(payload?.activities) ? payload.activities : [];
			allActivities.push(...activities);
			if (activities.length < DEFAULT_PAGE_SIZE) break;
		}
		return allActivities;
	});
}

async function fetchProjectMembership(accessToken: string, projectId: string) {
	const normalizedProjectId = normalizeCandidateProjectId(projectId);
	if (!normalizedProjectId) return [];

	try {
		return await withProjectRoute(
			accessToken,
			normalizedProjectId,
			async (call, _base, portalId) => {
				const allUsers: any[] = [];
				for (let page = 1; page <= MAX_PAGES; page += 1) {
					const payload = await call(
						buildProjectsApiEndpoint(
							portalId,
							normalizedProjectId,
							`/users/?page=${page}&per_page=${DEFAULT_PAGE_SIZE}`
						)
					);
					const users = Array.isArray(payload?.users) ? payload.users : [];
					allUsers.push(...users);
					if (users.length < DEFAULT_PAGE_SIZE) break;
				}
				return allUsers;
			}
		);
	} catch {
		return [];
	}
}

function isProjectMember(users: any[], email: string) {
	const normalizedEmail = email.toLowerCase().trim();
	for (const user of users) {
		const userEmail = typeof user?.email === 'string' ? user.email.toLowerCase().trim() : '';
		if (userEmail && userEmail === normalizedEmail) return true;
	}
	return false;
}

async function getMembershipProjectIdsForEmail(accessToken: string, email: string, allProjectIds: string[]) {
	const cacheKey = email.toLowerCase().trim();
	const cached = membershipProjectIdsByEmailCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < PROJECT_MEMBERSHIP_CACHE_TTL_MS) {
		return cached.projectIds;
	}

	const projectIds: string[] = [];
	const lookupProjectIds = allProjectIds.slice(0, MAX_PROJECT_MEMBERSHIP_LOOKUPS);

	for (const projectId of lookupProjectIds) {
		const users = await fetchProjectMembership(accessToken, projectId);
		if (isProjectMember(users, email)) {
			projectIds.push(projectId);
		}
	}

	membershipProjectIdsByEmailCache.set(cacheKey, { fetchedAt: Date.now(), projectIds });
	return projectIds;
}

async function getDealsForClientInternal(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null
) {
	if (!zohoContactId && !email) return [];

	const cacheKey = getClientCacheKey(zohoContactId, email);
	const cachedEntry = clientDealsCache.get(cacheKey);
	if (cachedEntry && Date.now() - cachedEntry.fetchedAt < CLIENT_DEALS_CACHE_TTL_MS) {
		return cachedEntry.deals;
	}

	const inFlight = clientDealsInFlightByKey.get(cacheKey);
	if (inFlight) return inFlight;

	const promise = (async () => {
		let deals: any[] = [];

		if (zohoContactId) {
			try {
				const result = await getContactDeals(accessToken, String(zohoContactId));
				if (Array.isArray(result)) deals = result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log.warn('getDealsForClient: failed to fetch deals by contact ID', {
					zohoContactId,
					error: message
				});
			}
		}

		if (deals.length === 0 && email) {
			try {
				const contact = await findContactByEmail(accessToken, email);
				const resolvedContactId = contact?.id ?? contact?.Contact_ID ?? null;
				if (resolvedContactId) {
					const result = await getContactDeals(accessToken, String(resolvedContactId));
					if (Array.isArray(result)) deals = result;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log.warn('getDealsForClient: failed to fetch deals by email fallback', {
					email,
					error: message
				});
			}
		}

		if (deals.length === 0 && email) {
			try {
				const payload = await zohoApiCall(
					accessToken,
					`/Deals/search?criteria=(Email:equals:${encodeURIComponent(email)})&fields=${CRM_DEAL_EMAIL_FALLBACK_FIELDS}&per_page=10`
				);
				const found = pickCrmArray(payload);
				if (found.length > 0) deals = found;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log.warn('getDealsForClient: email fallback search failed', {
					email,
					error: message
				});
			}
		}

		clientDealsCache.set(cacheKey, { fetchedAt: Date.now(), deals });
		clientDealsInFlightByKey.delete(cacheKey);
		return deals;
	})();

	clientDealsInFlightByKey.set(cacheKey, promise);
	return promise;
}

export async function getDealsForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null
) {
	return getDealsForClientInternal(accessToken, zohoContactId, email);
}

async function getProjectLinksForDeal(
	accessToken: string,
	deal: any,
	allProjects: any[],
	exactNameIndex: Map<string, string[]>,
	projectIdFieldApiNames: string[]
): Promise<ContactProjectLink[]> {
	const dealId = deal?.id ?? null;
	const dealName = getDealName(deal);
	const stage = typeof deal?.Stage === 'string' ? deal.Stage : undefined;

	// --- Strategy 1: project ID in deal fields ---
	const projectIdsFromFields = getDealProjectIdsForLinking(deal);
	if (projectIdsFromFields.length > 0) {
		return projectIdsFromFields.map((projectId) => ({
			contactId: deal.Contact_Name?.id ?? deal.Contact_Name ?? '',
			projectId,
			dealId: dealId ? String(dealId) : undefined,
			dealName: dealName ?? undefined,
			stage,
			matchSource: 'project_id_field' as const
		}));
	}

	// --- Strategy 2: project related list ---
	if (dealId) {
		const relatedListApiNames = await getDealProjectRelatedListApiNames(accessToken);
		const projectIdsFromRelatedList = await getProjectIdsFromDealRelatedLists(
			accessToken,
			String(dealId),
			relatedListApiNames
		);
		if (projectIdsFromRelatedList.length > 0) {
			return projectIdsFromRelatedList.map((projectId) => ({
				contactId: deal.Contact_Name?.id ?? deal.Contact_Name ?? '',
				projectId,
				dealId: dealId ? String(dealId) : undefined,
				dealName: dealName ?? undefined,
				stage,
				matchSource: 'related_list' as const
			}));
		}
	}

	// --- Strategy 3: exact name match ---
	const exactMatchCandidates = getDealExactMatchNameCandidates(deal);
	for (const candidate of exactMatchCandidates) {
		const matchedProjectIds = exactNameIndex.get(candidate);
		if (matchedProjectIds && matchedProjectIds.length === 1) {
			return [{
				contactId: deal.Contact_Name?.id ?? deal.Contact_Name ?? '',
				projectId: matchedProjectIds[0],
				dealId: dealId ? String(dealId) : undefined,
				dealName: dealName ?? undefined,
				stage,
				matchSource: 'name_match' as const
			}];
		}
	}

	return [];
}

async function getProjectLinksForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null,
	options?: { signal?: AbortSignal }
): Promise<ContactProjectLink[]> {
	if (!zohoContactId && !email) return [];

	const cacheKey = getClientCacheKey(zohoContactId, email);
	const cachedEntry = clientProjectLinksCache.get(cacheKey);
	if (cachedEntry && Date.now() - cachedEntry.fetchedAt < CLIENT_PROJECT_LINKS_CACHE_TTL_MS) {
		return cachedEntry.links;
	}

	const allProjects = await getProjectCatalog(accessToken);
	const exactNameIndex = buildExactProjectNameIndex(allProjects);

	const projectIdFieldApiNames = await getDealProjectFieldApiNames(accessToken);

	const deals = await getDealsForClientInternal(accessToken, zohoContactId, email);
	const sortedDeals = sortDealsForProjectMatching(deals);

	const allLinks: ContactProjectLink[] = [];
	const usedProjectIds = new Set<string>();

	for (const deal of sortedDeals) {
		const links = await getProjectLinksForDeal(
			accessToken,
			deal,
			allProjects,
			exactNameIndex,
			projectIdFieldApiNames
		);
		for (const link of links) {
			if (!usedProjectIds.has(link.projectId)) {
				usedProjectIds.add(link.projectId);
				allLinks.push(link);
			}
		}
	}

	// --- Strategy 4: fuzzy name match (fallback) ---
	const dealsWithNoMatch = sortedDeals.filter(
		(deal) => !allLinks.some((link) => link.dealId === String(deal.id ?? ''))
	);
	for (const deal of dealsWithNoMatch.slice(0, MAX_DEAL_RELATED_PROJECT_LOOKUPS)) {
		const bestMatch = findBestProjectMatchForDeal(deal, allProjects, usedProjectIds);
		if (!bestMatch) continue;
		const dealId = deal?.id ?? null;
		const dealName = getDealName(deal);
		const stage = typeof deal?.Stage === 'string' ? deal.Stage : undefined;
		allLinks.push({
			contactId: deal.Contact_Name?.id ?? deal.Contact_Name ?? '',
			projectId: bestMatch.projectId,
			dealId: dealId ? String(dealId) : undefined,
			dealName: dealName ?? undefined,
			stage,
			matchSource: 'name_match' as const
		});
		usedProjectIds.add(bestMatch.projectId);
	}

	clientProjectLinksCache.set(cacheKey, { fetchedAt: Date.now(), links: allLinks });
	return allLinks;
}

export async function getProjectsForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null,
	options?: { signal?: AbortSignal }
) {
	const links = await getProjectLinksForClient(accessToken, zohoContactId, email, options);
	if (links.length === 0) return [];

	const projectIds = links.map((l) => l.projectId);
	const allProjects = await getProjectCatalog(accessToken);

	const projectMap = new Map<string, any>();
	for (const p of allProjects) {
		const pid = getProjectId(p);
		if (pid) projectMap.set(pid, p);
	}

	return projectIds
		.map((id) => projectMap.get(id))
		.filter(Boolean);
}

export async function isProjectMemberForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email: string
) {
	const allProjects = await getProjectCatalog(accessToken);
	const allProjectIds = allProjects.map((p: any) => getProjectId(p)).filter(Boolean) as string[];

	const memberProjectIds = await getMembershipProjectIdsForEmail(
		accessToken,
		email,
		allProjectIds
	);

	return memberProjectIds.length > 0;
}

export type ZohoProjectTask = {
	taskId: string;
	taskName: string;
	status: string;
	projectId: string;
	tasklistId: string;
	tasklistName: string;
	projectName: string;
	isCompleted: boolean;
	createdTime?: string;
	modifiedTime?: string;
	dueDate?: string;
};

export type ZohoProjectTaskSummary = {
	totalCount: number;
	completedCount: number;
	inProgressCount: number;
	notStartedCount: number;
};

async function getTasksForProject(
	accessToken: string,
	projectId: string,
	projectName: string
): Promise<ZohoProjectTask[]> {
	const tasklists = await getTasklists(accessToken, projectId);
	const allTasks: ZohoProjectTask[] = [];

	for (const tasklist of tasklists.slice(0, MAX_TASKLIST_TASK_LOOKUPS)) {
		const tasklistId = String(tasklist?.id ?? '');
		const tasklistName = typeof tasklist?.name === 'string' ? tasklist.name : '';
		if (!tasklistId) continue;

		try {
			const tasks = await getTasksForTasklist(accessToken, projectId, tasklistId);
			for (const task of tasks) {
				const taskId = String(task?.id ?? '');
				const taskName = typeof task?.name === 'string' ? task.name : '';
				const statusName =
					typeof task?.status?.name === 'string'
						? task.status.name
						: typeof task?.status === 'string'
							? task.status
							: 'Open';
				const isCompleted = statusName.toLowerCase().includes('complete') || task?.completed === true;

				allTasks.push({
					taskId,
					taskName,
					status: statusName,
					projectId,
					tasklistId,
					tasklistName,
					projectName,
					isCompleted,
					createdTime: typeof task?.created_time === 'string' ? task.created_time : undefined,
					modifiedTime: typeof task?.modified_time === 'string' ? task.modified_time : undefined,
					dueDate: typeof task?.end_date === 'string' ? task.end_date : undefined
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('getTasksForProject: failed to fetch tasks for tasklist', {
				projectId,
				tasklistId,
				error: message
			});
		}
	}

	return allTasks;
}

export async function getTasksForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null
): Promise<ZohoProjectTask[]> {
	const links = await getProjectLinksForClient(accessToken, zohoContactId, email);
	if (links.length === 0) return [];

	const allProjects = await getProjectCatalog(accessToken);
	const projectMap = new Map<string, any>();
	for (const p of allProjects) {
		const pid = getProjectId(p);
		if (pid) projectMap.set(pid, p);
	}

	const allTasks: ZohoProjectTask[] = [];
	for (const link of links) {
		const project = projectMap.get(link.projectId);
		const projectName = getProjectName(project) ?? link.projectId;
		try {
			const tasks = await getTasksForProject(accessToken, link.projectId, projectName);
			allTasks.push(...tasks);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('getTasksForClient: failed to fetch tasks for project', {
				projectId: link.projectId,
				error: message
			});
		}
	}

	return allTasks;
}

export async function getTaskSummaryForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null
): Promise<ZohoProjectTaskSummary> {
	const tasks = await getTasksForClient(accessToken, zohoContactId, email);

	let completedCount = 0;
	let inProgressCount = 0;
	let notStartedCount = 0;

	for (const task of tasks) {
		if (task.isCompleted) {
			completedCount += 1;
		} else {
			const status = task.status.toLowerCase();
			if (status.includes('progress') || status.includes('active') || status.includes('started')) {
				inProgressCount += 1;
			} else {
				notStartedCount += 1;
			}
		}
	}

	return {
		totalCount: tasks.length,
		completedCount,
		inProgressCount,
		notStartedCount
	};
}

export async function getProjectsWithTasksForClient(
	accessToken: string,
	zohoContactId: string | null | undefined,
	email?: string | null
) {
	const links = await getProjectLinksForClient(accessToken, zohoContactId, email);
	if (links.length === 0) return [];

	const allProjects = await getProjectCatalog(accessToken);
	const projectMap = new Map<string, any>();
	for (const p of allProjects) {
		const pid = getProjectId(p);
		if (pid) projectMap.set(pid, p);
	}

	const results: Array<{
		project: any;
		tasks: ZohoProjectTask[];
		link: ContactProjectLink;
	}> = [];

	for (const link of links) {
		const project = projectMap.get(link.projectId);
		const projectName = getProjectName(project) ?? link.projectId;
		try {
			const tasks = await getTasksForProject(accessToken, link.projectId, projectName);
			results.push({ project, tasks, link });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('getProjectsWithTasksForClient: failed to fetch tasks for project', {
				projectId: link.projectId,
				error: message
			});
			results.push({ project, tasks: [], link });
		}
	}

	return results;
}

export async function rehydrateDeal(accessToken: string, dealId: string, extraFields?: string[]) {
	const fieldsList = [
		...CRM_DEAL_REHYDRATE_BASE_FIELDS,
		...(extraFields || [])
	].join(',');
	const payload = await zohoApiCall(accessToken, `/Deals/${encodeURIComponent(dealId)}?fields=${fieldsList}`);
	const records = pickCrmArray(payload);
	return records[0] ?? null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
