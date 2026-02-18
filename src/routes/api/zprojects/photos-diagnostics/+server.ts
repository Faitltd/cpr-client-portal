import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminSession } from '$lib/server/admin';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import {
	getProgressPhotosLinkCandidates,
	pickBestProgressPhotosFallback,
	resolveProgressPhotosLink
} from '$lib/server/progress-photos';
import { getDealsForClient } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const REQUIRED_WORKDRIVE_SCOPES = ['WorkDrive.files.READ', 'WorkDrive.folders.READ'];
const MAX_PROBES = 8;
const PROBE_TIMEOUT_MS = 9000;

type PortalSession = {
	client: {
		zoho_contact_id: string | null;
		email: string;
	};
};

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function normalizeScopeTokens(rawScope: string | null | undefined) {
	return (rawScope || '')
		.split(/[\s,]+/g)
		.map((token) => token.trim())
		.filter(Boolean);
}

function getTopDealName(deal: any) {
	const direct = deal?.Deal_Name;
	if (typeof direct === 'string' && direct.trim()) return direct.trim();
	if (direct && typeof direct === 'object') {
		const fromLookup = direct?.name ?? direct?.display_value ?? direct?.value ?? null;
		if (typeof fromLookup === 'string' && fromLookup.trim()) return fromLookup.trim();
	}
	return null;
}

function summarize(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.slice(0, 20);
	if (typeof value === 'object') return value;
	return String(value);
}

function extractStringUrls(value: unknown, output: string[]) {
	if (value === null || value === undefined) return;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return;
		const direct = trimmed.match(/^https?:\/\/\S+$/i);
		if (direct) {
			output.push(trimmed);
			return;
		}
		const matches = trimmed.match(/https?:\/\/[^\s"'<>]+/gi) || [];
		for (const match of matches) output.push(match);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) extractStringUrls(item, output);
		return;
	}
	if (typeof value !== 'object') return;
	for (const nested of Object.values(value as Record<string, unknown>)) {
		extractStringUrls(nested, output);
	}
}

function extractIdReferences(value: unknown) {
	const folderIds = new Set<string>();
	const fileIds = new Set<string>();
	const fieldsAttachmentIds = new Set<string>();
	const genericIds = new Set<string>();

	const seenObjects = new WeakSet<object>();
	const walk = (node: unknown, depth = 0) => {
		if (depth > 6 || node === null || node === undefined) return;

		if (typeof node === 'string') {
			const text = node.trim();
			if (!text) return;
			const pairPattern = /([a-z_]+)\s*[:=]\s*([a-z0-9_-]{8,})/gi;
			let pairMatch: RegExpExecArray | null = null;
			while ((pairMatch = pairPattern.exec(text))) {
				const key = String(pairMatch[1] || '').toLowerCase();
				const id = String(pairMatch[2] || '').trim();
				if (!id) continue;
				if (key.includes('folder')) folderIds.add(id);
				else if (key.includes('file')) fileIds.add(id);
				else if (key.includes('attachment')) fieldsAttachmentIds.add(id);
				else genericIds.add(id);
			}

			const urls: string[] = [];
			extractStringUrls(text, urls);
			for (const rawUrl of urls) {
				try {
					const url = new URL(rawUrl);
					const folderQuery =
						url.searchParams.get('folder_id') ||
						url.searchParams.get('folderId') ||
						url.searchParams.get('resource_id') ||
						url.searchParams.get('resourceId');
					if (folderQuery) folderIds.add(folderQuery);

					const fileQuery =
						url.searchParams.get('file_id') ||
						url.searchParams.get('fileId') ||
						url.searchParams.get('id');
					if (fileQuery) fileIds.add(fileQuery);

					const attachmentQuery =
						url.searchParams.get('fields_attachment_id') ||
						url.searchParams.get('attachment_id');
					if (attachmentQuery) fieldsAttachmentIds.add(attachmentQuery);

					const pathTokens = url.pathname.split('/').filter(Boolean);
					for (let i = 0; i < pathTokens.length; i += 1) {
						const token = pathTokens[i];
						const next = pathTokens[i + 1] || '';
						if (!next) continue;
						if (token.toLowerCase() === 'folder') folderIds.add(next);
						if (token.toLowerCase() === 'file') fileIds.add(next);
						if (token.toLowerCase().includes('attachment')) fieldsAttachmentIds.add(next);
					}
				} catch {
					// ignore malformed url
				}
			}
			return;
		}

		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
			return;
		}

		if (typeof node !== 'object') return;
		if (seenObjects.has(node as object)) return;
		seenObjects.add(node as object);

		for (const [rawKey, rawValue] of Object.entries(node as Record<string, unknown>)) {
			const key = rawKey.toLowerCase();
			if (rawValue === null || rawValue === undefined) continue;

			if (typeof rawValue === 'string' || typeof rawValue === 'number') {
				const text = String(rawValue).trim();
				if (text) {
					if (key.includes('folder')) folderIds.add(text);
					else if (key.includes('file')) fileIds.add(text);
					else if (key.includes('attachment')) fieldsAttachmentIds.add(text);
					else if (key === 'id' || key.endsWith('_id')) genericIds.add(text);
				}
			}

			walk(rawValue, depth + 1);
		}
	};

	walk(value, 0);

	return {
		workdriveFolderIds: Array.from(folderIds),
		workdriveFileIds: Array.from(fileIds),
		fieldsAttachmentIds: Array.from(fieldsAttachmentIds),
		genericIds: Array.from(genericIds)
	};
}

function containsInvalidLinkText(text: string) {
	const lower = text.toLowerCase();
	return (
		lower.includes('document not found') ||
		lower.includes('invalid url') ||
		lower.includes('this link is no longer valid') ||
		lower.includes('the link may have expired') ||
		lower.includes('learn more about invalid links')
	);
}

async function probeCandidate(url: string) {
	const result: {
		url: string;
		reachable: boolean;
		statusCode: number | null;
		finalUrl: string | null;
		invalidLinkPage: boolean;
		contentType: string | null;
		error: string | null;
	} = {
		url,
		reachable: false,
		statusCode: null,
		finalUrl: null,
		invalidLinkPage: false,
		contentType: null,
		error: null
	};

	try {
		const response = await fetch(url, {
			method: 'GET',
			redirect: 'follow',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
		result.statusCode = response.status;
		result.finalUrl = response.url || null;
		result.contentType = response.headers.get('content-type');

		if (!response.ok) {
			result.error = `HTTP ${response.status}`;
			return result;
		}

		const contentType = (result.contentType || '').toLowerCase();
		if (contentType.includes('text/') || contentType.includes('html') || contentType.includes('json')) {
			const body = await response.text();
			if (containsInvalidLinkText(body)) {
				result.invalidLinkPage = true;
				result.error = 'Invalid/expired link page content';
				return result;
			}
		}

		result.reachable = true;
		return result;
	} catch (err) {
		result.error = err instanceof Error ? err.message : String(err);
		return result;
	}
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho tokens not configured');

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain || undefined;

	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain, scope: tokens.scope || '' };
}

async function resolvePortalSession(cookies: { get(name: string): string | undefined }) {
	const token = cookies.get('portal_session');
	if (!token) return null;
	const session = await getSession(token);
	if (!session?.client) return null;
	return {
		client: {
			zoho_contact_id: session.client.zoho_contact_id,
			email: session.client.email
		}
	} as PortalSession;
}

async function canPortalSessionAccessDeal(session: PortalSession, dealId: string) {
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal) => String(deal?.id || '').trim() === dealId);
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const hasAdminSession = isValidAdminSession(cookies.get('admin_session'));
	const portalSession = hasAdminSession ? null : await resolvePortalSession(cookies);

	if (!hasAdminSession && !portalSession) {
		throw error(401, 'Admin or portal session required');
	}

	const dealId = String(url.searchParams.get('dealId') || '').trim();
	if (!dealId) {
		throw error(400, 'dealId query parameter required');
	}

	if (!hasAdminSession && portalSession) {
		const allowed = await canPortalSessionAccessDeal(portalSession, dealId);
		if (!allowed) throw error(403, 'Not authorized for this deal');
	}

	const { accessToken, apiDomain, scope } = await getAccessToken();

	const fields = [
		'id',
		'Deal_Name',
		'Stage',
		'Modified_Time',
		'Client_Portal_Folder',
		'Progress_Photos',
		'External_Link'
	];

	const payload = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent(fields.join(','))}`,
		{},
		apiDomain
	);
	const deal = payload?.data?.[0];
	if (!deal) throw error(404, 'Deal not found');

	const rawFieldValues = {
		Client_Portal_Folder: summarize(deal?.Client_Portal_Folder),
		Progress_Photos: summarize(deal?.Progress_Photos),
		External_Link: summarize(deal?.External_Link)
	};

	const candidates = getProgressPhotosLinkCandidates(deal);
	const selectedCandidate = pickBestProgressPhotosFallback(candidates) || null;
	const resolvedCandidate = (await resolveProgressPhotosLink(deal)) || null;
	const effectiveCandidate = resolvedCandidate || selectedCandidate;

	const probeTargets = candidates.slice(0, MAX_PROBES);
	const probes = await Promise.all(probeTargets.map((candidate) => probeCandidate(candidate)));

	const fieldReferences = {
		Client_Portal_Folder: extractIdReferences(deal?.Client_Portal_Folder),
		Progress_Photos: extractIdReferences(deal?.Progress_Photos),
		External_Link: extractIdReferences(deal?.External_Link)
	};

	const combinedRefs = extractIdReferences(rawFieldValues);
	const scopeTokens = normalizeScopeTokens(scope);
	const missingWorkDriveScopes = REQUIRED_WORKDRIVE_SCOPES.filter(
		(scopeToken) => !scopeTokens.includes(scopeToken)
	);

	let sourceType: 'workdrive' | 'crm_field_updates' | 'expiring_public_link' | 'unknown' = 'unknown';
	let canonicalFieldApiName: string | null = null;
	let canonicalReferenceValue: string | null = null;

	for (const [field, refs] of Object.entries(fieldReferences)) {
		if (refs.workdriveFolderIds.length > 0) {
			sourceType = 'workdrive';
			canonicalFieldApiName = field;
			canonicalReferenceValue = refs.workdriveFolderIds[0];
			break;
		}
	}

	if (sourceType === 'unknown') {
		for (const [field, refs] of Object.entries(fieldReferences)) {
			if (refs.fieldsAttachmentIds.length > 0) {
				sourceType = 'crm_field_updates';
				canonicalFieldApiName = field;
				canonicalReferenceValue = refs.fieldsAttachmentIds[0];
				break;
			}
		}
	}

	if (sourceType === 'unknown' && candidates.length > 0) {
		sourceType = 'expiring_public_link';
		for (const fieldName of ['Client_Portal_Folder', 'Progress_Photos', 'External_Link'] as const) {
			const urls: string[] = [];
			extractStringUrls((deal as any)?.[fieldName], urls);
			if (urls.length > 0) {
				canonicalFieldApiName = fieldName;
				canonicalReferenceValue = urls[0];
				break;
			}
		}
	}

	const allInvalid = probes.length > 0 && probes.every((probe) => probe.invalidLinkPage || !probe.reachable);
	let failureReason: string | null = null;
	let recommendedImplementationPath =
		'No durable photos source detected. Configure a stable folder/attachment ID source in CRM.';

	if (sourceType === 'workdrive') {
		recommendedImplementationPath =
			missingWorkDriveScopes.length === 0
				? 'Implement WorkDrive ID-based listing + authenticated proxy download endpoints.'
				: `Add missing WorkDrive scopes (${missingWorkDriveScopes.join(', ')}) then implement ID-based listing/proxy.`;
		if (missingWorkDriveScopes.length > 0) {
			failureReason = `Missing OAuth scopes: ${missingWorkDriveScopes.join(', ')}`;
		}
	} else if (sourceType === 'crm_field_updates') {
		recommendedImplementationPath =
			'Reuse CRM fields-attachment proxy pattern (used in trade endpoints) for client photo access.';
	} else if (sourceType === 'expiring_public_link') {
		recommendedImplementationPath =
			'Do not trust public URLs as source of truth. Move to WorkDrive folder ID or CRM attachment IDs.';
		if (allInvalid) {
			failureReason = 'All discovered candidates resolve to invalid/expired link pages.';
		}
	} else if (candidates.length === 0) {
		failureReason = 'No URL candidates found in Client_Portal_Folder / Progress_Photos / External_Link.';
	}

	return json({
		mode: hasAdminSession ? 'admin' : 'client',
		deal: {
			id: String(deal?.id || dealId),
			name: getTopDealName(deal),
			stage: typeof deal?.Stage === 'string' ? deal.Stage : null,
			modifiedTime: typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null
		},
		scopeInfo: {
			tokenCount: scopeTokens.length,
			scopeTokens,
			requiredWorkDriveScopes: REQUIRED_WORKDRIVE_SCOPES,
			missingWorkDriveScopes
		},
		sourceOfTruthReport: {
			sourceType,
			canonicalFieldApiName,
			canonicalReferenceValue,
			currentlySelectedUrl: selectedCandidate,
			resolvedUrl: resolvedCandidate,
			effectiveUrl: effectiveCandidate,
			failureReason,
			recommendedImplementationPath
		},
		rawFieldValues,
		parsedReferences: {
			byField: fieldReferences,
			combined: combinedRefs
		},
		candidates,
		probeResults: probes
	});
};
