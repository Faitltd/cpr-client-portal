import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminSession } from '$lib/server/admin';
import { isPortalActiveStage } from '$lib/server/auth';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient, getProjectLinksForClient, parseZohoProjectIds } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const BASE_DEAL_FIELDS = ['id', 'Deal_Name', 'Stage', 'Created_Time', 'Modified_Time', 'Contact_Name'];
const MAX_SAMPLE_DEALS = 20;
const REQUIRED_PROJECT_SCOPES = [
	'ZohoProjects.portals.READ',
	'ZohoProjects.projects.READ',
	'ZohoProjects.tasks.READ',
	'ZohoProjects.tasklists.READ',
	'ZohoProjects.milestones.READ',
	'ZohoProjects.users.READ'
];

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function getArray(payload: any, ...keys: string[]) {
	for (const key of keys) {
		if (Array.isArray(payload?.[key])) return payload[key];
	}
	return [];
}

function containsProjectText(value: unknown) {
	if (typeof value !== 'string') return false;
	return value.toLowerCase().includes('project');
}

function pickProjectFieldCandidates(fields: any[]) {
	return (fields || []).filter((field) => {
		const apiName = field?.api_name;
		const label = field?.field_label;
		const dataType = field?.data_type;
		const lookupModule = field?.lookup?.module;
		return (
			containsProjectText(apiName) ||
			containsProjectText(label) ||
			containsProjectText(dataType) ||
			containsProjectText(lookupModule)
		);
	});
}

function pickProjectRelatedLists(relatedLists: any[]) {
	return (relatedLists || []).filter((item) => {
		return (
			containsProjectText(item?.api_name) ||
			containsProjectText(item?.name) ||
			containsProjectText(item?.display_label) ||
			containsProjectText(item?.plural_label) ||
			containsProjectText(item?.module)
		);
	});
}

function summarizeValue(value: unknown) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.slice(0, 5);
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const summary: Record<string, unknown> = {};
		const keys = ['id', 'name', 'display_value', 'value', 'project_id', 'projectId', 'api_name', 'module'];
		for (const key of keys) {
			if (record[key] !== undefined) summary[key] = record[key];
		}
		return Object.keys(summary).length > 0 ? summary : record;
	}
	return String(value);
}

function extractDealName(deal: any) {
	const value = deal?.Deal_Name;
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (value && typeof value === 'object') {
		const lookup = value as Record<string, unknown>;
		const candidate = lookup.name ?? lookup.display_value ?? null;
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	}
	return null;
}

function normalizeScopeTokens(rawScope: string | null | undefined) {
	return (rawScope || '')
		.split(/[,\s]+/g)
		.map((value) => value.trim())
		.filter(Boolean);
}

function extractProjectIdsFromDealRecord(deal: any, candidateFieldApiNames: string[]) {
	const ids = new Set<string>();
	const fieldNames = Array.from(new Set(['Zoho_Projects_ID', ...candidateFieldApiNames]));
	for (const fieldName of fieldNames) {
		const value = deal?.[fieldName];
		for (const id of parseZohoProjectIds(value)) {
			ids.add(id);
		}
	}
	return Array.from(ids);
}

async function fetchDealsByIds(accessToken: string, dealIds: string[], fields: string[]) {
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
		const payload = await zohoApiCall(
			accessToken,
			`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields.join(','))}`
		);
		const deals = getArray(payload, 'data', 'Deals');
		results.push(...deals);
	}
	return results;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const hasAdminSession = isValidAdminSession(cookies.get('admin_session'));
	let portalSession:
		| {
				client: {
					zoho_contact_id: string | null;
					email: string;
				};
		  }
		| null = null;

	if (!hasAdminSession) {
		const portalSessionToken = cookies.get('portal_session');
		if (portalSessionToken) {
			const session = await getSession(portalSessionToken);
			if (session?.client) {
				portalSession = {
					client: {
						zoho_contact_id: session.client.zoho_contact_id,
						email: session.client.email
					}
				};
			}
		}
		if (!portalSession) {
			throw error(401, 'Admin or portal session required');
		}
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	let fields: any[] = [];
	let relatedLists: any[] = [];
	let fieldsError: string | null = null;
	let relatedListsError: string | null = null;

	try {
		const fieldsPayload = await zohoApiCall(accessToken, '/settings/fields?module=Deals');
		fields = getArray(fieldsPayload, 'fields', 'data');
	} catch (err) {
		fieldsError = err instanceof Error ? err.message : String(err);
	}

	try {
		const relatedListsPayload = await zohoApiCall(accessToken, '/settings/related_lists?module=Deals');
		relatedLists = getArray(relatedListsPayload, 'related_lists', 'data');
	} catch (err) {
		relatedListsError = err instanceof Error ? err.message : String(err);
	}

	const projectFieldCandidates = pickProjectFieldCandidates(fields);
	const projectRelatedLists = pickProjectRelatedLists(relatedLists);
	const candidateFieldApiNames = Array.from(
		new Set(
			projectFieldCandidates
				.map((field) => (typeof field?.api_name === 'string' ? field.api_name.trim() : ''))
				.filter(Boolean)
		)
	);

	if (!candidateFieldApiNames.includes('Zoho_Projects_ID')) {
		candidateFieldApiNames.push('Zoho_Projects_ID');
	}

	const requestedFields = Array.from(new Set([...BASE_DEAL_FIELDS, ...candidateFieldApiNames]));
	const sampledDeals: any[] = [];
	let dealsError: string | null = null;

	try {
		if (hasAdminSession) {
			const perPage = 100;
			for (let page = 1; page <= 3; page += 1) {
				const payload = await zohoApiCall(
					accessToken,
					`/Deals?fields=${encodeURIComponent(requestedFields.join(','))}&per_page=${perPage}&page=${page}`
				);
				const deals = getArray(payload, 'data', 'Deals');
				if (deals.length === 0) break;

				for (const deal of deals) {
					const stage = typeof deal?.Stage === 'string' ? deal.Stage : '';
					if (!isPortalActiveStage(stage)) continue;
					sampledDeals.push(deal);
					if (sampledDeals.length >= MAX_SAMPLE_DEALS) break;
				}

				if (sampledDeals.length >= MAX_SAMPLE_DEALS) break;
				if (payload?.info?.more_records !== true && deals.length < perPage) break;
			}
		} else if (portalSession) {
			const clientDeals = await getDealsForClient(
				portalSession.client.zoho_contact_id,
				portalSession.client.email
			);
			const activeClientDeals = (clientDeals || []).filter((deal) =>
				isPortalActiveStage(typeof deal?.Stage === 'string' ? deal.Stage : '')
			);
			const clientDealIds = activeClientDeals
				.map((deal) => (deal?.id ? String(deal.id) : ''))
				.filter(Boolean)
				.slice(0, MAX_SAMPLE_DEALS);
			const fullDeals = await fetchDealsByIds(accessToken, clientDealIds, requestedFields);
			sampledDeals.push(...fullDeals.slice(0, MAX_SAMPLE_DEALS));
		}
	} catch (err) {
		dealsError = err instanceof Error ? err.message : String(err);
	}

	const sampleDeals = sampledDeals.map((deal) => {
		const projectFields: Record<string, unknown> = {};
		for (const apiName of candidateFieldApiNames) {
			if (deal?.[apiName] !== undefined) {
				projectFields[apiName] = summarizeValue(deal[apiName]);
			}
		}
		const extractedProjectIds = extractProjectIdsFromDealRecord(deal, candidateFieldApiNames);

		return {
			id: deal?.id ? String(deal.id) : null,
			dealName: extractDealName(deal),
			stage: typeof deal?.Stage === 'string' ? deal.Stage : null,
			modifiedTime: typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null,
			projectFields,
			extractedProjectIds
		};
	});

	const scopeTokens = normalizeScopeTokens(tokens.scope ?? null);
	const missingProjectScopes = REQUIRED_PROJECT_SCOPES.filter((scope) => !scopeTokens.includes(scope));
	let clientMappingPreview: {
		dealsCount: number;
		linksCount: number;
		sampleLink: {
			projectId: string;
			dealId: string | null;
			dealName: string | null;
			stage: string | null;
		} | null;
		sampleDeal: {
			id: string | null;
			dealName: string | null;
			stage: string | null;
			extractedProjectIds: string[];
		} | null;
	} | null = null;

	try {
		if (portalSession?.client) {
			const [clientDeals, clientLinks] = await Promise.all([
				getDealsForClient(portalSession.client.zoho_contact_id, portalSession.client.email),
				getProjectLinksForClient(portalSession.client.zoho_contact_id, portalSession.client.email)
			]);
			const sampleDealRaw = (clientDeals || [])[0] || null;
			const sampleDeal = sampleDealRaw
				? {
						id: sampleDealRaw?.id ? String(sampleDealRaw.id) : null,
						dealName: extractDealName(sampleDealRaw),
						stage: typeof sampleDealRaw?.Stage === 'string' ? sampleDealRaw.Stage : null,
						extractedProjectIds: extractProjectIdsFromDealRecord(sampleDealRaw, candidateFieldApiNames)
					}
				: null;
			const sampleLinkRaw = (clientLinks || [])[0] || null;
			const sampleLink = sampleLinkRaw
				? {
						projectId: sampleLinkRaw.projectId,
						dealId: sampleLinkRaw.dealId,
						dealName: sampleLinkRaw.dealName,
						stage: sampleLinkRaw.stage
					}
				: null;

			clientMappingPreview = {
				dealsCount: clientDeals.length,
				linksCount: clientLinks.length,
				sampleLink,
				sampleDeal
			};
		}
	} catch (err) {
		clientMappingPreview = {
			dealsCount: 0,
			linksCount: 0,
			sampleLink: null,
			sampleDeal: {
				id: null,
				dealName: null,
				stage: null,
				extractedProjectIds: []
			}
		};
	}

	return json({
		mode: hasAdminSession ? 'admin' : 'client',
		scope: tokens.scope ?? null,
		scopeInfo: {
			tokenCount: scopeTokens.length,
			scopeTokens,
			requiredProjectScopes: REQUIRED_PROJECT_SCOPES,
			missingProjectScopes
		},
		fields: {
			total: fields.length,
			error: fieldsError,
			projectFieldCandidates: projectFieldCandidates.map((field) => ({
				api_name: field?.api_name ?? null,
				field_label: field?.field_label ?? null,
				data_type: field?.data_type ?? null,
				json_type: field?.json_type ?? null,
				lookup_module: field?.lookup?.module ?? null
			})),
			candidateFieldApiNames
		},
		relatedLists: {
			total: relatedLists.length,
			error: relatedListsError,
			projectRelatedLists: projectRelatedLists.map((item) => ({
				api_name: item?.api_name ?? null,
				name: item?.name ?? null,
				display_label: item?.display_label ?? null,
				module: item?.module ?? null
			}))
		},
		deals: {
			error: dealsError,
			requestedFields,
			sampleCount: sampleDeals.length,
			sampleDeals
		},
		clientMappingPreview
	});
};
