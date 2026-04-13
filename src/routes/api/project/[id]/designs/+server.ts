import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getCachedFolder, setCachedFolder } from '$lib/server/folder-cache';
import { createLogger } from '$lib/server/logger';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	extractExternalLinkHash,
	extractWorkDriveFolderId,
	listWorkDriveFolder,
	resolveExternalLink,
	buildDealFolderCandidates,
	findBestFolderByName,
	getWorkDriveApiBase
} from '$lib/server/workdrive';
import type { RequestHandler } from './$types';

const log = createLogger('client-designs');
const WORKDRIVE_ROOT_FOLDER_VALUE = env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID || '';
const DESIGN_FOLDER_NAMES = ['design and planning', 'design & planning', 'designs and planning', 'designs', 'design'];
const PROJECT_SUBFOLDER_NAMES = ['client portal', 'photos', 'permits', 'job costing'];

function getRootFolderId() {
	const parsed = extractWorkDriveFolderId(WORKDRIVE_ROOT_FOLDER_VALUE);
	return parsed || WORKDRIVE_ROOT_FOLDER_VALUE.trim();
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
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain };
}

function normalizeName(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function findDesignFolder(items: { id: string; name: string; type: string }[]) {
	const folders = items.filter((i) => i.type === 'folder');
	for (const target of DESIGN_FOLDER_NAMES) {
		const match = folders.find((f) => normalizeName(f.name) === target);
		if (match) return match;
	}
	for (const target of DESIGN_FOLDER_NAMES) {
		const match = folders.find((f) => normalizeName(f.name).includes(target));
		if (match) return match;
	}
	return null;
}

function looksLikeProjectContents(items: { name: string; type: string }[]) {
	const folderNames = items
		.filter((i) => i.type === 'folder')
		.map((i) => normalizeName(i.name));
	const matchCount = PROJECT_SUBFOLDER_NAMES.filter((target) =>
		folderNames.some((f) => f === target || f.includes(target))
	).length;
	return matchCount >= 2;
}

async function getParentFolderId(
	accessToken: string,
	folderId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	try {
		const response = await fetch(`${base}/files/${encodeURIComponent(folderId)}`, {
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			}
		});
		if (!response.ok) return null;
		const data = await response.json().catch(() => null);
		const parentId =
			data?.data?.attributes?.parent_id ||
			data?.data?.attributes?.parentId ||
			'';
		return parentId ? String(parentId).trim() : null;
	} catch {
		return null;
	}
}

function extractShareLinkUrl(data: any): string | null {
	const link =
		data?.data?.attributes?.link ||
		data?.data?.attributes?.url ||
		data?.data?.attributes?.permalink ||
		data?.data?.attributes?.download_url ||
		'';
	return typeof link === 'string' && link.trim() ? link.trim() : null;
}

async function getExistingShareLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	try {
		const response = await fetch(
			`${base}/files/${encodeURIComponent(resourceId)}/links`,
			{
				headers: {
					Authorization: `Zoho-oauthtoken ${accessToken}`,
					Accept: 'application/vnd.api+json'
				}
			}
		);
		if (!response.ok) return null;
		const data = await response.json().catch(() => null);
		const links = data?.data;
		if (!Array.isArray(links) || links.length === 0) return null;
		// Return the first view link found
		for (const entry of links) {
			const url =
				entry?.attributes?.link ||
				entry?.attributes?.url ||
				entry?.attributes?.permalink ||
				'';
			if (typeof url === 'string' && url.trim()) return url.trim();
		}
		return null;
	} catch {
		return null;
	}
}

async function getOrCreateExternalShareLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	// First check for an existing share link
	const existing = await getExistingShareLink(accessToken, resourceId, apiDomain);
	if (existing) {
		log.info('Using existing share link', { resourceId });
		return existing;
	}

	// Create a new one
	const base = getWorkDriveApiBase(apiDomain);
	const shortId = resourceId.slice(-12);
	const payload = {
		data: {
			attributes: {
				resource_id: resourceId,
				link_name: `designs_${shortId}`,
				link_type: 'view',
				request_user_data: false,
				allow_download: true
			},
			type: 'links'
		}
	};
	try {
		const response = await fetch(`${base}/links`, {
			method: 'POST',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json'
			},
			body: JSON.stringify(payload)
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			log.info('createExternalShareLink failed', { resourceId, status: response.status, body: body.slice(0, 200) });
			return null;
		}
		const data = await response.json().catch(() => null);
		return extractShareLinkUrl(data);
	} catch (err) {
		log.info('createExternalShareLink error', { resourceId, error: String(err) });
		return null;
	}
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const debug = url.searchParams.get('debug') === '1';
	const steps: string[] = [];

	const { accessToken, apiDomain } = await getAccessToken();
	if (debug) steps.push(`auth: ok, apiDomain=${apiDomain || 'default'}`);

	// Verify client has access to this deal
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '').trim() === dealId)) {
		throw error(403, 'Access denied to this project');
	}
	if (debug) steps.push(`access: verified, ${deals.length} deals found`);

	// Fetch the deal with fields we need
	const dealFields = 'Deal_Name,Client_Portal_Folder,External_Link,Designs';
	const dealResponse = await zohoApiCall(
		accessToken,
		`/Deals/${dealId}?fields=${encodeURIComponent(dealFields)}`,
		{},
		apiDomain
	);
	const deal = dealResponse?.data?.[0];
	const dealName = deal?.Deal_Name || '';

	if (debug) {
		steps.push(`deal: ${deal ? 'found' : 'NOT FOUND'}, name="${dealName}"`);
		steps.push(`crm_fields: Designs=${JSON.stringify(deal?.Designs ?? null)}, Client_Portal_Folder=${JSON.stringify(deal?.Client_Portal_Folder ?? null)}, External_Link=${JSON.stringify(deal?.External_Link ?? null)}`);
	}

	log.info('Client design folder lookup', {
		dealId,
		dealName,
		designs: deal?.Designs ? String(deal.Designs).slice(0, 100) : null,
		clientPortalFolder: deal?.Client_Portal_Folder ? String(deal.Client_Portal_Folder).slice(0, 100) : null,
		externalLink: deal?.External_Link ? String(deal.External_Link).slice(0, 100) : null
	});

	// If the CRM "Designs" field contains a WorkDrive URL, extract the folder ID
	// and create a scoped external share link (never return internal WorkDrive URLs).
	const designsFieldValue = deal?.Designs;
	if (typeof designsFieldValue === 'string' && designsFieldValue.trim()) {
		if (debug) steps.push(`designs_field: has value, trying to extract folder ID`);
		const designsFolderId = extractWorkDriveFolderId(designsFieldValue.trim());
		if (designsFolderId) {
			if (debug) steps.push(`designs_field: extracted folder ID ${designsFolderId}`);
			const shareLink = await getOrCreateExternalShareLink(accessToken, designsFolderId, apiDomain);
			if (shareLink) {
				return json({ url: shareLink, ...(debug ? { debug: steps } : {}) });
			}
			if (debug) steps.push(`designs_field: share link creation FAILED`);
			return json({ url: null, message: 'Unable to create external share link for designs folder', ...(debug ? { debug: steps } : {}) });
		}

		const hash = extractExternalLinkHash(designsFieldValue.trim());
		if (hash) {
			if (debug) steps.push(`designs_field: found external link hash ${hash}`);
			const resolvedId = await resolveExternalLink(accessToken, hash, apiDomain);
			if (resolvedId) {
				if (debug) steps.push(`designs_field: resolved to folder ${resolvedId}`);
				const shareLink = await getOrCreateExternalShareLink(accessToken, resolvedId, apiDomain);
				if (shareLink) {
					return json({ url: shareLink, ...(debug ? { debug: steps } : {}) });
				}
				if (debug) steps.push(`designs_field: share link creation FAILED`);
			} else {
				if (debug) steps.push(`designs_field: external link resolve FAILED`);
			}
			return json({ url: null, message: 'Unable to create external share link for designs folder', ...(debug ? { debug: steps } : {}) });
		}
		if (debug) steps.push(`designs_field: not a WorkDrive URL or external link`);
	} else {
		if (debug) steps.push(`designs_field: empty or not set`);
	}

	// Fall back to WorkDrive folder lookup to find the design subfolder
	let projectFolderId = '';
	let folderSource = '';

	// Step 1: Check folder cache
	try {
		const cached = await getCachedFolder(dealId, 'root');
		if (cached) {
			projectFolderId = cached.folderId;
			folderSource = 'cache';
			if (debug) steps.push(`step1_cache: HIT, folderId=${projectFolderId}`);
		} else {
			if (debug) steps.push(`step1_cache: miss`);
		}
	} catch (err) {
		if (debug) steps.push(`step1_cache: error - ${String(err)}`);
	}

	// Step 2: Try extracting folder ID from CRM fields
	if (!projectFolderId) {
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const extracted = extractWorkDriveFolderId(field) || '';
			if (extracted) {
				projectFolderId = extracted;
				folderSource = 'crm-field-id';
				if (debug) steps.push(`step2_crm: extracted folder ID ${extracted} from "${String(field).slice(0, 80)}"`);
				break;
			}
		}
		if (!projectFolderId && debug) steps.push(`step2_crm: no folder ID extracted`);
	}

	// Step 3: Try resolving external share links
	if (!projectFolderId) {
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const hash = extractExternalLinkHash(field);
			if (hash) {
				if (debug) steps.push(`step3_resolve: trying hash ${hash}`);
				const resolved = await resolveExternalLink(accessToken, hash, apiDomain);
				if (resolved) {
					projectFolderId = resolved;
					folderSource = 'external-link-resolved';
					if (debug) steps.push(`step3_resolve: resolved to ${resolved}`);
					break;
				} else {
					if (debug) steps.push(`step3_resolve: resolve failed for hash ${hash}`);
				}
			}
		}
		if (!projectFolderId && debug) steps.push(`step3_resolve: no folder resolved`);
	}

	// Step 4: Search root WorkDrive folder by deal name
	if (!projectFolderId) {
		const rootId = getRootFolderId();
		if (debug) steps.push(`step4_search: rootId=${rootId || 'NOT SET'}, dealName="${dealName}"`);
		if (rootId) {
			const candidates = buildDealFolderCandidates(dealName);
			if (debug) steps.push(`step4_search: candidates=${JSON.stringify(candidates)}`);
			if (candidates.length > 0) {
				try {
					let searchFolderId = rootId;
					const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain);
					if (debug) steps.push(`step4_search: root listing returned ${rootItems.length} items`);

					if (looksLikeProjectContents(rootItems)) {
						const parentId = await getParentFolderId(accessToken, rootId, apiDomain);
						if (parentId) {
							searchFolderId = parentId;
							if (debug) steps.push(`step4_search: root is project contents, using parent ${parentId}`);
						}
					}

					const parentItems = searchFolderId !== rootId
						? await listWorkDriveFolder(accessToken, searchFolderId, apiDomain)
						: rootItems;

					if (debug) {
						const folderNames = parentItems.filter(i => i.type === 'folder').map(i => i.name);
						steps.push(`step4_search: ${folderNames.length} folders: ${folderNames.slice(0, 10).join(', ')}${folderNames.length > 10 ? '...' : ''}`);
					}

					const match = findBestFolderByName(parentItems, candidates);
					if (match) {
						projectFolderId = match.id;
						folderSource = 'name-match';
						if (debug) steps.push(`step4_search: MATCHED "${match.name}" -> ${match.id}`);
						try { await setCachedFolder(dealId, 'root', match.id, match.name); } catch {}
					} else {
						if (debug) steps.push(`step4_search: no match found`);
					}
				} catch (err) {
					if (debug) steps.push(`step4_search: ERROR - ${String(err)}`);
					log.info('Client design folder: root search failed', { dealId, error: String(err) });
				}
			}
		}
	}

	if (!projectFolderId) {
		if (debug) steps.push(`RESULT: project folder not found`);
		return json({ url: null, message: 'Project folder not found', ...(debug ? { debug: steps } : {}) });
	}

	// Step 5: Find "Design and Planning" subfolder
	const items = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
	if (debug) {
		const subfolders = items.filter(i => i.type === 'folder').map(i => i.name);
		steps.push(`step5_design: project folder ${projectFolderId} (${folderSource}) has ${subfolders.length} subfolders: ${subfolders.join(', ')}`);
	}
	const designFolder = findDesignFolder(items);

	if (!designFolder) {
		if (debug) steps.push(`RESULT: design subfolder not found`);
		return json({ url: null, message: 'Design and Planning folder not found', ...(debug ? { debug: steps } : {}) });
	}

	if (debug) steps.push(`step5_design: found "${designFolder.name}" -> ${designFolder.id}`);

	if (folderSource !== 'cache') {
		try { await setCachedFolder(dealId, 'root', projectFolderId); } catch {}
	}

	// Step 6: Create a scoped external share link for the design folder only
	const shareLink = await getOrCreateExternalShareLink(accessToken, designFolder.id, apiDomain);
	if (shareLink) {
		if (debug) steps.push(`step6_link: SUCCESS -> ${shareLink}`);
		return json({ url: shareLink, ...(debug ? { debug: steps } : {}) });
	}

	if (debug) steps.push(`step6_link: FAILED to get or create share link`);
	// Never fall back to internal WorkDrive URLs — they expose the entire drive
	return json({ url: null, message: 'Unable to create external share link for designs folder', ...(debug ? { debug: steps } : {}) });
};
