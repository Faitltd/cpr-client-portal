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

	if (projectId) {
		for (const derivedId of derivePortalIdCandidatesFromProjectId(projectId)) {
			addId(derivedId);
		}
	}

	if (
		discoveredPortalIdCache &&
		discoveredPortalIdCache.base === base &&
		Date.now() - discoveredPortalIdCache.fetchedAt < PORTAL_ID_CACHE_TTL_MS
	) {
		addId(discoveredPortalIdCache.portalId);
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
	// copy of the same project name). Keep the ambiguity guard for weaker fuzzy matches.
	if (best.score < 90 && best.score - secondBestScore < 5) return null;
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
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to fetch contacts chunk for deal-email fallback', {
				chunkSize: chunk.length,
				error: message
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

async function fetchDealsByIds(accessToken: string, dealIds: string[], fields: string[] = CRM_DEAL_REHYDRATE_BASE_FIELDS) {
	const uniqueIds = Array.from(
		new Set(
			(dealIds || [])
				.map((id) => (id === null || id === undefined ? '' : String(id).trim()))
				.filter(Boolean)
		)
	);
	if (uniqueIds.length === 0) return [] as any[];

	const results: any[] = [];
	const chunkSize = 100;

	for (let i = 0; i < uniqueIds.length; i += chunkSize) {
		const chunk = uniqueIds.slice(i, i + chunkSize);
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields.join(','))}`
			);
			const deals = Array.isArray(response?.data) ? response.data : [];
			results.push(...deals);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to rehydrate Deals by IDs for project mapping', {
				chunkSize: chunk.length,
				error: message
			});
		}
	}

	return results;
}

async function rehydrateDealsForProjectMapping(accessToken: string, deals: any[]) {
	const deduped = dedupeDealsById(deals || []);
	if (deduped.length === 0) return deduped;

	const dealIds = deduped
		.map((deal) => getDealId(deal))
		.filter((id): id is string => Boolean(id))
		.slice(0, 250);
	if (dealIds.length === 0) return deduped;

	const projectFieldApiNames = await getDealProjectFieldApiNames(accessToken);
	const requestedFields = Array.from(
		new Set([...CRM_DEAL_REHYDRATE_BASE_FIELDS, ...projectFieldApiNames])
	);
	const freshDeals = await fetchDealsByIds(accessToken, dealIds, requestedFields);
	if (freshDeals.length === 0) return deduped;

	const freshById = new Map<string, any>(
		freshDeals
			.map((deal) => {
				const id = getDealId(deal);
				return id ? ([id, deal] as const) : null;
			})
			.filter(Boolean) as Array<readonly [string, any]>
	);

	return deduped.map((deal) => {
		const dealId = getDealId(deal);
		if (!dealId) return deal;
		const fresh = freshById.get(dealId);
		if (!fresh) return deal;
		return {
			...deal,
			...fresh
		};
	});
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

function normalizeEmail(value: unknown) {
	if (typeof value !== 'string') return '';
	return value.trim().toLowerCase();
}

function dedupeProjectsById(projects: any[]) {
	const deduped: any[] = [];
	const seen = new Set<string>();
	for (const project of projects || []) {
		const id = getProjectId(project);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		deduped.push(project);
	}
	return deduped;
}

function getProjectStatusName(project: any) {
	const candidate = project?.status ?? project?.project_status ?? project?.status_name ?? null;
	if (typeof candidate !== 'string') return '';
	return candidate.trim().toLowerCase();
}

function isProjectLikelyArchived(project: any) {
	const status = getProjectStatusName(project);
	if (!status) return false;
	return status.includes('archive');
}

function parseProjectUsers(payload: any) {
	if (!payload) return [];
	if (Array.isArray(payload?.users)) return payload.users;
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

function parseProjectTasklists(payload: any) {
	if (!payload) return [];
	if (Array.isArray(payload?.tasklists)) return payload.tasklists;
	if (Array.isArray(payload?.tasklist)) return payload.tasklist;
	if (Array.isArray(payload?.task_lists)) return payload.task_lists;
	if (payload?.tasklists && typeof payload.tasklists === 'object') {
		const values = Object.values(payload.tasklists);
		if (values.some((item) => item && typeof item === 'object')) return values;
	}
	if (payload?.tasklist && typeof payload.tasklist === 'object') {
		const values = Object.values(payload.tasklist);
		if (values.some((item) => item && typeof item === 'object')) return values;
	}
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

function looksLikeProjectTaskRecord(value: any) {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).map((key) => key.toLowerCase());
	if (keys.length === 0) return false;
	if (keys.includes('task_name') || keys.includes('task_status')) return true;
	if (keys.includes('percent_complete') || keys.includes('percent_completed')) return true;
	if (keys.includes('completion_percentage')) return true;
	if (keys.includes('completed') || keys.includes('is_completed')) return true;
	if (keys.includes('task_id') || keys.includes('taskid')) return true;
	if ((keys.includes('name') || keys.includes('title')) && (keys.includes('status') || keys.includes('id'))) {
		return true;
	}
	return false;
}

function parseProjectTasks(payload: any) {
	const collected: any[] = [];
	const seen = new Set<string>();
	const addTask = (value: unknown) => {
		if (!looksLikeProjectTaskRecord(value)) return;
		const task = value as any;
		const key = getProjectTaskDedupKey(task);
		if (seen.has(key)) return;
		seen.add(key);
		collected.push(task);
	};

	const visit = (value: unknown, depth = 0, keyHint = '') => {
		if (depth > 6 || value === null || value === undefined) return;

		if (Array.isArray(value)) {
			for (const item of value) {
				if (looksLikeProjectTaskRecord(item)) {
					addTask(item);
				}
			}
			for (const item of value) {
				if (item && typeof item === 'object' && !looksLikeProjectTaskRecord(item)) {
					visit(item, depth + 1, keyHint);
				}
			}
			return;
		}

		if (typeof value !== 'object') return;
		const record = value as Record<string, unknown>;

		if (looksLikeProjectTaskRecord(record)) {
			addTask(record);
			return;
		}

		for (const [key, child] of Object.entries(record)) {
			if (!child) continue;
			const lowerKey = key.toLowerCase();
			const prioritize =
				lowerKey.includes('task') ||
				lowerKey.includes('todo') ||
				lowerKey.includes('item') ||
				lowerKey.includes('open') ||
				lowerKey.includes('close') ||
				keyHint.includes('task');
			if (prioritize || depth <= 2) {
				visit(child, depth + 1, lowerKey);
			}
		}
	};

	visit(payload, 0, '');
	return collected;
}

function getProjectTaskDedupKey(task: any) {
	const idCandidates = [task?.id, task?.task_id, task?.taskId, task?.key];
	for (const candidate of idCandidates) {
		if (candidate === null || candidate === undefined) continue;
		const trimmed = String(candidate).trim();
		if (trimmed) return `id:${trimmed}`;
	}

	const name =
		typeof task?.name === 'string'
			? task.name.trim()
			: typeof task?.task_name === 'string'
				? task.task_name.trim()
				: typeof task?.title === 'string'
					? task.title.trim()
					: '';
	const status =
		typeof task?.status === 'string'
			? task.status.trim()
			: typeof task?.task_status === 'string'
				? task.task_status.trim()
				: typeof task?.status_name === 'string'
					? task.status_name.trim()
					: '';
	const start =
		typeof task?.start_date === 'string'
			? task.start_date.trim()
			: typeof task?.start_time === 'string'
				? task.start_time.trim()
				: '';
	const end =
		typeof task?.end_date === 'string'
			? task.end_date.trim()
			: typeof task?.due_date === 'string'
				? task.due_date.trim()
				: '';

	const fingerprint = `${name}|${status}|${start}|${end}`;
	if (fingerprint !== '|||') return `meta:${fingerprint}`;

	try {
		return `json:${JSON.stringify(task)}`;
	} catch {
		return 'json:{}';
	}
}

function dedupeProjectTasks(tasks: any[]) {
	const deduped: any[] = [];
	const seen = new Set<string>();
	for (const task of tasks || []) {
		const key = getProjectTaskDedupKey(task);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(task);
	}
	return deduped;
}

function getProjectTasklistId(tasklist: any) {
	if (!tasklist || typeof tasklist !== 'object') return '';
	const candidates = [tasklist.id, tasklist.tasklist_id, tasklist.task_list_id, tasklist.tasklistId];
	for (const candidate of candidates) {
		if (candidate === null || candidate === undefined) continue;
		const trimmed = String(candidate).trim();
		if (trimmed) return trimmed;
	}
	return '';
}

type TaskPaginationMode = 'page' | 'index';

async function fetchAllTasksForEndpoint(
	baseEndpoint: string,
	perPage: number,
	extraParams?: Record<string, string>,
	paginationMode: TaskPaginationMode = 'page'
) {
	const collected: any[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const query = new URLSearchParams();
		if (paginationMode === 'index') {
			query.set('index', String((page - 1) * perPage + 1));
			query.set('range', String(perPage));
		} else {
			query.set('page', String(page));
			query.set('per_page', String(perPage));
		}
		for (const [key, value] of Object.entries(extraParams || {})) {
			if (!value) continue;
			query.set(key, value);
		}
		if (!query.has('sort_column')) query.set('sort_column', 'created_time');
		if (!query.has('sort_order')) query.set('sort_order', 'ascending');
		const qs = query.toString();
		const endpoint = qs ? `${baseEndpoint}?${qs}` : baseEndpoint;
		const payload = await projectsApiCall(endpoint);
		const items = dedupeProjectTasks(parseProjectTasks(payload));
		if (items.length === 0) return { tasks: dedupeProjectTasks(collected), hadSuccess: true };

		let newCount = 0;
		for (const item of items) {
			const key = getProjectTaskDedupKey(item);
			if (seen.has(key)) continue;
			seen.add(key);
			collected.push(item);
			newCount += 1;
		}

		if (newCount === 0) return { tasks: dedupeProjectTasks(collected), hadSuccess: true };
		if (!hasMorePages(payload, items.length, perPage)) return { tasks: dedupeProjectTasks(collected), hadSuccess: true };
	}

	return { tasks: dedupeProjectTasks(collected), hadSuccess: true };
}

async function getProjectCatalogForMatching() {
	if (projectCatalogCache && Date.now() - projectCatalogCache.fetchedAt < PROJECT_CATALOG_CACHE_TTL_MS) {
		return projectCatalogCache.projects;
	}

	const accessToken = await getValidAccessToken();
	const [activeResult, archivedResult] = await Promise.allSettled([
		listAllProjectsAcrossPortals(accessToken, 'active', 100),
		listAllProjectsAcrossPortals(accessToken, 'archived', 100)
	]);

	let activeProjects = activeResult.status === 'fulfilled' ? activeResult.value : [];
	let archivedProjects = archivedResult.status === 'fulfilled' ? archivedResult.value : [];

	// Fallback to the default paginator path if cross-portal catalog lookup fails.
	if (activeProjects.length === 0) {
		try {
			activeProjects = await listAllProjects('active', 100);
		} catch {
			activeProjects = [];
		}
	}
	if (archivedProjects.length === 0) {
		try {
			archivedProjects = await listAllProjects('archived', 100);
		} catch {
			archivedProjects = [];
		}
	}

	const merged = dedupeProjectsById([...activeProjects, ...archivedProjects]);
	projectCatalogCache = { fetchedAt: Date.now(), projects: merged };
	return merged;
}

async function getProjectIdsByClientEmail(projects: any[], email: string) {
	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail) return new Set<string>();

	const cached = membershipProjectIdsByEmailCache.get(normalizedEmail);
	if (cached && Date.now() - cached.fetchedAt < PROJECT_MEMBERSHIP_CACHE_TTL_MS) {
		return new Set(cached.projectIds);
	}

	const projectIds = dedupeProjectsById(projects)
		.map((project) => getProjectId(project))
		.filter((id): id is string => Boolean(id))
		.slice(0, MAX_PROJECT_MEMBERSHIP_LOOKUPS);

	const matches = await mapWithConcurrency(projectIds, 3, async (projectId) => {
		try {
			const usersPayload = await getProjectUsers(projectId);
			const users = parseProjectUsers(usersPayload);
			const hasEmail = users.some((user: any) => {
				const userEmail = normalizeEmail(
					user?.email ?? user?.user_email ?? user?.mail ?? user?.login_email ?? user?.zuid_email
				);
				return userEmail === normalizedEmail;
			});
			return hasEmail ? projectId : '';
		} catch {
			return '';
		}
	});

	const matchedProjectIds = matches.filter(Boolean);
	membershipProjectIdsByEmailCache.set(normalizedEmail, {
		fetchedAt: Date.now(),
		projectIds: matchedProjectIds
	});
	return new Set(matchedProjectIds);
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

function pickProjectsArray(payload: any) {
	if (Array.isArray(payload?.projects)) return payload.projects;
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

async function fetchProjectsPageForBasePortal(
	accessToken: string,
	base: string,
	portalId: string,
	status: 'active' | 'archived',
	page: number,
	perPage: number
) {
	const query = new URLSearchParams();
	query.set('status', status);
	query.set('page', String(page));
	query.set('per_page', String(perPage));

	const url = `${base}/api/v3/portal/${portalId}/projects?${query.toString()}`;
	const response = await fetchProjectsApiWithTimeout(
		url,
		{
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
		},
		`list projects (${base} portal ${portalId})`
	);

	if (response.status === 204) return {};

	if (response.status === 429) {
		const text = await response.text().catch(() => '');
		log.warn('Zoho Projects API rate limit exceeded (429). Zoho may block requests for ~30 minutes.', {
			status: 429,
			endpoint: '/projects',
			base,
			portalId,
			response: text
		});
		throw new Error(`Zoho Projects API error 429: ${text}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Projects API error ${response.status}: ${text}`);
	}

	return response.json();
}

async function listAllProjectsAcrossPortals(
	accessToken: string,
	status: 'active' | 'archived',
	perPage = DEFAULT_PAGE_SIZE
) {
	const merged: any[] = [];
	const mergedById = new Set<string>();
	const baseCandidates = getProjectsApiBaseCandidates();

	for (const base of baseCandidates) {
		const portalIds = await getPortalIdCandidatesForBase(accessToken, base);
		for (const portalId of portalIds) {
			let hadResultsForPortal = false;
			for (let page = 1; page <= MAX_PAGES; page += 1) {
				let payload: any = {};
				try {
					payload = await fetchProjectsPageForBasePortal(accessToken, base, portalId, status, page, perPage);
				} catch {
					break;
				}

				const projects = pickProjectsArray(payload);
				if (projects.length === 0) break;
				hadResultsForPortal = true;

				for (const project of projects) {
					const projectId = getProjectId(project);
					if (!projectId || mergedById.has(projectId)) continue;
					mergedById.add(projectId);
					cacheProjectRoute(projectId, base, portalId);
					merged.push(project);
				}

				if (!hasMorePages(payload, projects.length, perPage)) break;
			}

			if (hadResultsForPortal) {
				cacheProjectsApiBase(base);
				discoveredPortalIdCache = { portalId, base, fetchedAt: Date.now() };
			}
		}
	}

	return merged;
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
	const preferredBase = getPreferredProjectsApiBase();
	const projectId = extractProjectIdFromEndpoint(endpoint);
	const isProjectsListEndpoint = endpoint === '/projects' || endpoint.startsWith('/projects?');
	const baseCandidates = [preferredBase, ...getProjectsApiBaseCandidates()]
		.map((base) => normalizeProjectsApiBase(base))
		.filter(Boolean);

	const seenBases = new Set<string>();
	const errors: string[] = [];
	let firstEmptyProjectsPayload: any = null;
	let routeAttemptCount = 0;
	let stoppedByRouteAttemptLimit = false;

	baseLoop: for (const base of baseCandidates) {
		if (seenBases.has(base)) continue;
		seenBases.add(base);

		let portalIds = await getPortalIdCandidatesForBase(accessToken, base, projectId || undefined);
		if (portalIds.length === 0) {
			try {
				const fallbackPortalId = await resolvePortalId(accessToken);
				if (fallbackPortalId) portalIds = [fallbackPortalId];
			} catch {
				// No fallback portal id found; continue to next base candidate.
				portalIds = [];
			}
		}

		if (portalIds.length === 0) {
			errors.push(`${base} -> no portal ids available`);
			continue;
		}

		for (const portalId of portalIds) {
			if (projectId && routeAttemptCount >= MAX_PROJECT_ROUTE_ATTEMPTS) {
				stoppedByRouteAttemptLimit = true;
				break baseLoop;
			}
			if (projectId) routeAttemptCount += 1;

			const url = `${base}/api/v3/portal/${portalId}${endpoint}`;
			const response = await fetchProjectsApiWithTimeout(
				url,
				{
					...options,
					headers: {
						Authorization: `Zoho-oauthtoken ${accessToken}`,
						'Content-Type': 'application/json',
						...options.headers
					}
				},
				`${endpoint} (${base} portal ${portalId})`
			);

			if (response.status === 204) {
				cacheProjectsApiBase(base);
				discoveredPortalIdCache = { portalId, base, fetchedAt: Date.now() };
				if (projectId) cacheProjectRoute(projectId, base, portalId);
				return {};
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

			if (response.ok) {
				const payload = await response.json().catch(() => ({}));
				const projects = Array.isArray(payload?.projects) ? payload.projects : [];

				if (isProjectsListEndpoint && projects.length === 0) {
					if (firstEmptyProjectsPayload === null) firstEmptyProjectsPayload = payload;
					continue;
				}

				cacheProjectsApiBase(base);
				discoveredPortalIdCache = { portalId, base, fetchedAt: Date.now() };
				if (projectId) cacheProjectRoute(projectId, base, portalId);
				return payload;
			}

			const text = await response.text().catch(() => '');
			errors.push(`${base} portal ${portalId} -> ${response.status}: ${text}`);
		}
	}

	if (isProjectsListEndpoint && firstEmptyProjectsPayload !== null) {
		return firstEmptyProjectsPayload;
	}

	if (stoppedByRouteAttemptLimit) {
		errors.push(`stopped after ${MAX_PROJECT_ROUTE_ATTEMPTS} route attempts`);
	}

	throw new Error(
		`Zoho Projects API request failed across candidate API bases for ${endpoint}. ${errors.join(' | ')}`
	);
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
		status?: string;
		view_type?: string;
		index?: number;
		range?: number;
	}
) {
	const query = new URLSearchParams();
	if (params?.page) query.set('page', String(params.page));
	if (params?.per_page) query.set('per_page', String(params.per_page));
	if (params?.status) query.set('status', String(params.status));
	if (params?.view_type) query.set('view_type', String(params.view_type));
	if (params?.index !== undefined) query.set('index', String(params.index));
	if (params?.range !== undefined) query.set('range', String(params.range));
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
	let lastError: unknown = null;
	let hadSuccessfulTaskFetch = false;

	const endpointStrategies: Array<{
		params: Record<string, string>;
		paginationMode: TaskPaginationMode;
	}> = [
		{ params: { status: 'all', view_type: 'all' }, paginationMode: 'page' },
		{ params: { status: 'all', view_type: 'all' }, paginationMode: 'index' },
		{ params: { status: 'all' }, paginationMode: 'page' },
		{ params: { status: 'all' }, paginationMode: 'index' },
		{ params: {}, paginationMode: 'page' },
		{ params: {}, paginationMode: 'index' }
	];

	const cachedTaskStrategy = taskStrategyCache.get(projectId);
	if (cachedTaskStrategy && Date.now() - cachedTaskStrategy.fetchedAt < TASK_STRATEGY_CACHE_TTL_MS) {
		const strategy = endpointStrategies[cachedTaskStrategy.strategyIndex];
		if (strategy) {
			try {
				const result = await fetchAllTasksForEndpoint(
					`/projects/${projectId}/tasks`,
					perPage,
					strategy.params,
					strategy.paginationMode
				);
				if (result.hadSuccess) hadSuccessfulTaskFetch = true;
				if (result.tasks.length > 0) return result.tasks;
			} catch (err) {
				lastError = err;
			}
		}
	}

	for (let i = 0; i < endpointStrategies.length; i += 1) {
		const strategy = endpointStrategies[i];
		try {
			const result = await fetchAllTasksForEndpoint(
				`/projects/${projectId}/tasks`,
				perPage,
				strategy.params,
				strategy.paginationMode
			);
			if (result.hadSuccess) hadSuccessfulTaskFetch = true;
			if (result.tasks.length > 0) {
				taskStrategyCache.set(projectId, { fetchedAt: Date.now(), strategyIndex: i });
				return result.tasks;
			}
		} catch (err) {
			lastError = err;
		}
	}

	try {
		const tasklistsPayload = await getProjectTasklists(projectId);
		const tasklists = parseProjectTasklists(tasklistsPayload);
		const tasklistIds = Array.from(
			new Set(
				tasklists
					.map((tasklist: any) => getProjectTasklistId(tasklist))
					.filter((tasklistId: string): tasklistId is string => Boolean(tasklistId))
			)
		).slice(0, MAX_TASKLIST_TASK_LOOKUPS);

		if (tasklistIds.length > 0) {
			const tasklistResults = await mapWithConcurrency(tasklistIds, 1, async (tasklistId) => {
				for (const strategy of endpointStrategies) {
					try {
						const result = await fetchAllTasksForEndpoint(
							`/projects/${projectId}/tasklists/${tasklistId}/tasks`,
							perPage,
							strategy.params,
							strategy.paginationMode
						);
						if (result.tasks.length > 0) return result.tasks;
					} catch {
						// Continue trying additional tasklist fetch variants.
					}
				}
				return [] as any[];
			});

			const mergedTasklistTasks = dedupeProjectTasks(tasklistResults.flat());
			if (mergedTasklistTasks.length > 0) return mergedTasklistTasks;
			hadSuccessfulTaskFetch = true;
		}
	} catch (err) {
		lastError = lastError ?? err;
	}

	if (!hadSuccessfulTaskFetch && lastError) {
		throw lastError;
	}
	return [];
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
	const preferredBase = getPreferredProjectsApiBase();
	const baseCandidates = [preferredBase, ...getProjectsApiBaseCandidates()]
		.map((base) => normalizeProjectsApiBase(base))
		.filter(Boolean);
	const seenBases = new Set<string>();
	const errors: string[] = [];

	for (const base of baseCandidates) {
		if (seenBases.has(base)) continue;
		seenBases.add(base);

		try {
			const payload = await fetchPortalsPayload(accessToken, base);
			cacheProjectsApiBase(base);
			return {
				...payload,
				_meta: {
					base
				}
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`${base}: ${message}`);
		}
	}

	throw new Error(`Portals API failed across candidate API bases. ${errors.join(' | ')}`);
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
			log.warn('Failed to fetch CRM task summary for deal', { dealId, error: message });
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
			log.warn('Failed to fetch CRM task count for deal', { dealId, error: message });
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
	const cacheKey = getClientCacheKey(zohoContactId, email);
	const cached = clientDealsCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CLIENT_DEALS_CACHE_TTL_MS) {
		return cached.deals;
	}

	const inFlight = clientDealsInFlightByKey.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}

	const loadPromise = (async () => {
		const accessToken = await getValidAccessToken();
		const trimmedContactId = zohoContactId ? String(zohoContactId).trim() : '';
		const trimmedEmail = email ? String(email).trim() : '';
		const collectedDeals: any[] = [];

		if (trimmedContactId) {
			try {
				const primaryDeals = await getContactDeals(accessToken, trimmedContactId);
				if (Array.isArray(primaryDeals) && primaryDeals.length > 0) {
					collectedDeals.push(...primaryDeals);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log.warn('Failed to fetch deals by session contact id', { contactId: trimmedContactId, error: message });
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
				const message = err instanceof Error ? err.message : String(err);
				log.warn('Failed to resolve contact by email for deals fallback', {
					email: trimmedEmail,
					error: message
				});
			}

			if (collectedDeals.length === 0) {
				try {
					const emailMatchedDeals = await fetchDealsByEmailFallback(accessToken, trimmedEmail);
					if (emailMatchedDeals.length > 0) {
						collectedDeals.push(...emailMatchedDeals);
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					log.warn('Failed to fetch deals by email fallback scan', {
						email: trimmedEmail,
						error: message
					});
				}
			}
		}

		const dedupedDeals = dedupeDealsById(collectedDeals);
		try {
			const rehydratedDeals = await rehydrateDealsForProjectMapping(accessToken, dedupedDeals);
			clientDealsCache.set(cacheKey, { fetchedAt: Date.now(), deals: rehydratedDeals });
			return rehydratedDeals;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to rehydrate deals for Zoho Projects mapping', { error: message });
			clientDealsCache.set(cacheKey, { fetchedAt: Date.now(), deals: dedupedDeals });
			return dedupedDeals;
		}
	})();

	clientDealsInFlightByKey.set(cacheKey, loadPromise);
	try {
		return await loadPromise;
	} finally {
		clientDealsInFlightByKey.delete(cacheKey);
	}
}

export async function getProjectLinksForClient(
	zohoContactId: string | null | undefined,
	email?: string | null
): Promise<ContactProjectLink[]> {
	const cacheKey = getClientCacheKey(zohoContactId, email);
	const cached = clientProjectLinksCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CLIENT_PROJECT_LINKS_CACHE_TTL_MS) {
		return cached.links;
	}

	const deals = await getDealsForClient(zohoContactId, email);
	const dealsById = new Map<string, any>(
		(deals || [])
			.map((deal) => {
				const id = getDealId(deal);
				return id ? ([id, deal] as const) : null;
			})
			.filter(Boolean) as Array<readonly [string, any]>
	);

	const byProjectId = new Map<string, ContactProjectLink>();
	for (const deal of deals || []) {
		const ids = getDealProjectIdsForLinking(deal);
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
		const ids = getDealProjectIdsForLinking(deal);
		return ids.length === 0;
	});
	const sortedUnmappedDeals = sortDealsForProjectMatching(unmappedDeals);
	const mappedDealIds = new Set<string>(
		Array.from(byProjectId.values())
			.map((link) => (link.dealId ? String(link.dealId) : ''))
			.filter(Boolean)
	);

	// Automatic CRM related-list mapping: discover project ids directly from Deal related lists.
	// This covers orgs where Zoho_Projects_ID is not populated but Deal->Projects related data exists.
	if (byProjectId.size === 0 && sortedUnmappedDeals.length > 0) {
		try {
			const accessToken = await getValidAccessToken();
			const relatedListApiNames = await getDealProjectRelatedListApiNames(accessToken);
			const dealsToLookup = sortedUnmappedDeals.slice(0, MAX_DEAL_RELATED_PROJECT_LOOKUPS);
			const results = await mapWithConcurrency(dealsToLookup, 2, async (deal) => {
				const dealId = getDealId(deal);
				if (!dealId) return { deal, projectIds: [] as string[] };
				const projectIds = await getProjectIdsFromDealRelatedLists(accessToken, dealId, relatedListApiNames);
				return { deal, projectIds };
			});

			for (const result of results) {
				const deal = result.deal;
				const dealId = getDealId(deal);
				if (!dealId || result.projectIds.length === 0) continue;

				const dealName = getDealName(deal);
				const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
				const modifiedTime = typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null;

				for (const projectId of result.projectIds) {
					if (byProjectId.has(projectId)) continue;
					byProjectId.set(projectId, {
						projectId,
						dealId,
						dealName,
						stage,
						modifiedTime
					});
					mappedDealIds.add(dealId);
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to discover Zoho Projects links from Deal related lists', { error: message });
		}
	}

	const unresolvedUnmappedDeals = sortedUnmappedDeals.filter((deal) => {
		const dealId = getDealId(deal);
		return !dealId || !mappedDealIds.has(dealId);
	});

	if (byProjectId.size > 0 || unresolvedUnmappedDeals.length > 0 || (byProjectId.size === 0 && email)) {
		try {
			const projects = await getProjectCatalogForMatching();
			const activeProjects = projects.filter((project) => !isProjectLikelyArchived(project));
			const projectsById = new Map<string, any>(
				dedupeProjectsById(projects)
					.map((project) => {
						const id = getProjectId(project);
						return id ? ([id, project] as const) : null;
					})
					.filter(Boolean) as Array<readonly [string, any]>
			);
			const hasUsableProjectCatalog = projectsById.size > 0;

			// Prefer exact name matches first (e.g. Deal_Name exactly equals Zoho Project name).
			// This avoids falling through to CRM task cards when a canonical project exists.
			if (hasUsableProjectCatalog) {
				const exactProjectNameIndex = buildExactProjectNameIndex(
					dedupeProjectsById([...activeProjects, ...projects])
				);
				const usedProjectIds = new Set<string>(Array.from(byProjectId.keys()));
				const candidateDeals = sortDealsForProjectMatching(deals || []);

				for (const deal of candidateDeals) {
					const dealId = getDealId(deal);
					if (!dealId) continue;
					const exactNameCandidates = getDealExactMatchNameCandidates(deal);
					if (exactNameCandidates.length === 0) continue;

					let matchedProjectId = '';
					for (const candidateName of exactNameCandidates) {
						const projectIds = exactProjectNameIndex.get(candidateName) || [];
						const preferred = projectIds.find((projectId) => !usedProjectIds.has(projectId));
						if (preferred) {
							matchedProjectId = preferred;
							break;
						}
						const alreadyMappedToDeal = projectIds.find((projectId) => {
							const link = byProjectId.get(projectId);
							return link?.dealId === dealId;
						});
						if (alreadyMappedToDeal) {
							matchedProjectId = alreadyMappedToDeal;
							break;
						}
					}
					if (!matchedProjectId) continue;

					for (const [projectId, link] of Array.from(byProjectId.entries())) {
						if (link?.dealId === dealId && projectId !== matchedProjectId) {
							byProjectId.delete(projectId);
						}
					}

					const dealName = getDealName(deal);
					const stage = typeof deal?.Stage === 'string' ? deal.Stage : null;
					const modifiedTime = typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null;
					usedProjectIds.add(matchedProjectId);
					byProjectId.set(matchedProjectId, {
						projectId: matchedProjectId,
						dealId,
						dealName,
						stage,
						modifiedTime
					});
					mappedDealIds.add(dealId);
				}
			}
			const invalidMappedDeals: any[] = [];
			if (hasUsableProjectCatalog) {
				for (const [projectId, link] of Array.from(byProjectId.entries())) {
					if (projectsById.has(projectId)) continue;
					byProjectId.delete(projectId);

					const dealId = link?.dealId ? String(link.dealId) : '';
					if (!dealId) continue;
					const deal = dealsById.get(dealId);
					if (deal) invalidMappedDeals.push(deal);
				}
			}

			const candidateDeals = sortDealsForProjectMatching(
				dedupeDealsById([...unresolvedUnmappedDeals, ...invalidMappedDeals])
			);
			const usedProjectIds = new Set<string>(byProjectId.keys());
			const unresolvedDeals: any[] = [];

			for (const deal of hasUsableProjectCatalog ? candidateDeals : []) {
				const match =
					findBestProjectMatchForDeal(deal, activeProjects, usedProjectIds) ||
					findBestProjectMatchForDeal(deal, projects, usedProjectIds);
				if (!match) {
					unresolvedDeals.push(deal);
					continue;
				}

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

			// Secondary fallback: infer by explicit project membership and keep unmatched member
			// projects visible so we can still show real Zoho Projects tasks.
			if (email && byProjectId.size === 0 && hasUsableProjectCatalog) {
				const memberProjectIds = await getProjectIdsByClientEmail(projects, email);
				const activeMemberIds = Array.from(memberProjectIds).filter((id) => {
					if (usedProjectIds.has(id)) return false;
					const project = projectsById.get(id);
					return project ? !isProjectLikelyArchived(project) : true;
				});

				const memberProjectsForMatching = activeMemberIds
					.map((id) => projectsById.get(id))
					.filter(Boolean);

				for (const deal of unresolvedDeals) {
					const match = findBestProjectMatchForDeal(deal, memberProjectsForMatching, usedProjectIds);
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

				for (const projectId of activeMemberIds) {
					if (usedProjectIds.has(projectId)) continue;
					usedProjectIds.add(projectId);
					byProjectId.set(projectId, {
						projectId,
						dealId: null,
						dealName: null,
						stage: null,
						modifiedTime: null
					});
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to discover Zoho Projects links by deal-name matching', { error: message });
		}
	}

	const links = Array.from(byProjectId.values());
	clientProjectLinksCache.set(cacheKey, { fetchedAt: Date.now(), links });
	return links;
}
