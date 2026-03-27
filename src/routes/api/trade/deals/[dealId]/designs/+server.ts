import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
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

const log = createLogger('trade-designs');
const WORKDRIVE_ROOT_FOLDER_VALUE = env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID || '';
const DESIGN_FOLDER_NAMES = ['design and planning', 'design & planning', 'designs and planning', 'designs', 'design'];
/** Standard subfolder names found inside every project folder */
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

/**
 * Detect if a folder listing looks like the INSIDE of a project folder
 * (contains standard subfolders like "Client Portal", "Photos", etc.)
 * rather than a listing of project folders.
 */
function looksLikeProjectContents(items: { name: string; type: string }[]) {
	const folderNames = items
		.filter((i) => i.type === 'folder')
		.map((i) => normalizeName(i.name));
	const matchCount = PROJECT_SUBFOLDER_NAMES.filter((target) =>
		folderNames.some((f) => f === target || f.includes(target))
	).length;
	return matchCount >= 2;
}

/**
 * Get the parent folder ID of a given folder via WorkDrive API.
 */
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

async function createExternalShareLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	// link_name must be short — Zoho rejects names > ~50 chars
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
		const link =
			data?.data?.attributes?.link ||
			data?.data?.attributes?.url ||
			data?.data?.attributes?.permalink ||
			data?.data?.attributes?.download_url ||
			'';
		return typeof link === 'string' && link.trim() ? link.trim() : null;
	} catch (err) {
		log.info('createExternalShareLink error', { resourceId, error: String(err) });
		return null;
	}
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.dealId || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const { accessToken, apiDomain } = await getAccessToken();

	// Verify trade partner has access to this deal
	const dealList = await getTradePartnerDeals(accessToken, undefined, apiDomain);
	const accessibleDeal = dealList.find((item: any) => String(item?.id || '').trim() === dealId);
	if (!accessibleDeal) throw error(403, 'Access denied to this project');

	// Fetch the deal directly from Zoho with the fields we need
	const dealFields = 'Deal_Name,Client_Portal_Folder,External_Link';
	const dealResponse = await zohoApiCall(
		accessToken,
		`/Deals/${dealId}?fields=${encodeURIComponent(dealFields)}`,
		{},
		apiDomain
	);
	const deal = dealResponse?.data?.[0];
	const dealName = deal?.Deal_Name || accessibleDeal?.Deal_Name || '';

	log.info('Design folder lookup', {
		dealId,
		dealName,
		clientPortalFolder: deal?.Client_Portal_Folder ? String(deal.Client_Portal_Folder).slice(0, 100) : null,
		externalLink: deal?.External_Link ? String(deal.External_Link).slice(0, 100) : null
	});

	// ── Step 1: Check folder cache ──────────────────────────────────────
	let projectFolderId = '';
	let folderSource = '';

	try {
		const cached = await getCachedFolder(dealId, 'root');
		if (cached) {
			projectFolderId = cached.folderId;
			folderSource = 'cache';
			log.info('Design folder: cache hit', { dealId, folderId: projectFolderId });
		}
	} catch {}

	// ── Step 2: Try extracting folder ID from CRM fields ────────────────
	if (!projectFolderId) {
		// Try both fields — External_Link sometimes has a one.zoho.com URL with embedded folder ID
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const extracted = extractWorkDriveFolderId(field) || '';
			if (extracted) {
				projectFolderId = extracted;
				folderSource = 'crm-field-id';
				log.info('Design folder: extracted ID from CRM field', { dealId, folderId: projectFolderId });
				break;
			}
		}
	}

	// ── Step 3: Try resolving external share links ──────────────────────
	if (!projectFolderId) {
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const hash = extractExternalLinkHash(field);
			if (hash) {
				const resolved = await resolveExternalLink(accessToken, hash, apiDomain);
				if (resolved) {
					projectFolderId = resolved;
					folderSource = 'external-link-resolved';
					log.info('Design folder: resolved external link', { dealId, folderId: projectFolderId });
					break;
				}
			}
		}
	}

	// ── Step 4: Search root WorkDrive folder by deal name ───────────────
	if (!projectFolderId) {
		const rootId = getRootFolderId();
		if (rootId) {
			const candidates = buildDealFolderCandidates(dealName);
			if (candidates.length > 0) {
				try {
					let searchFolderId = rootId;

					// List the "root" folder and check if it's actually a project folder
					// (contains Client Portal, Photos, etc.) rather than the parent of all projects.
					const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain);

					if (looksLikeProjectContents(rootItems)) {
						// The configured root IS a project folder — navigate UP to the real parent
						log.info('Design folder: root is a project folder, navigating to parent', { dealId, rootId });
						const parentId = await getParentFolderId(accessToken, rootId, apiDomain);
						if (parentId) {
							searchFolderId = parentId;
							log.info('Design folder: found parent folder', { dealId, parentId });
						} else {
							log.info('Design folder: could not find parent folder', { dealId });
						}
					}

					// List the actual parent folder to find the project folder by name
					const parentItems = searchFolderId !== rootId
						? await listWorkDriveFolder(accessToken, searchFolderId, apiDomain)
						: rootItems;

					const folderNames = parentItems.filter((i) => i.type === 'folder').map((i) => i.name);
					log.info('Design folder: searching for project folder', {
						dealId,
						searchFolderId,
						candidates,
						folderCount: folderNames.length,
						sampleFolders: folderNames.slice(0, 15)
					});

					const match = findBestFolderByName(parentItems, candidates);
					if (match) {
						projectFolderId = match.id;
						folderSource = 'name-match';
						log.info('Design folder: matched by name', { dealId, folderId: match.id, folderName: match.name });
						try { await setCachedFolder(dealId, 'root', match.id, match.name); } catch {}
					}
				} catch (err) {
					log.info('Design folder: root search failed', { dealId, error: String(err) });
				}
			}
		}
	}

	if (!projectFolderId) {
		log.info('Design folder: project folder not found', { dealId, dealName });
		return json({ url: null, message: 'Project folder not found' });
	}

	// ── Step 5: Find "Design and Planning" subfolder ────────────────────
	const items = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
	const subfolders = items.filter((i) => i.type === 'folder').map((i) => i.name);
	const designFolder = findDesignFolder(items);

	log.info('Design folder: subfolder search', {
		dealId,
		projectFolderId,
		folderSource,
		subfolders,
		designFolderFound: !!designFolder,
		designFolderName: designFolder?.name || null
	});

	if (!designFolder) {
		return json({ url: null, message: 'Design and Planning folder not found', subfolders });
	}

	// Cache the project folder for future lookups
	if (folderSource !== 'cache') {
		try { await setCachedFolder(dealId, 'root', projectFolderId); } catch {}
	}

	// ── Step 6: Create external share link or use fallback ──────────────
	const shareLink = await createExternalShareLink(accessToken, designFolder.id, apiDomain);
	if (shareLink) {
		log.info('Design folder: share link created', { dealId, folderId: designFolder.id });
		return json({ url: shareLink });
	}

	const fallbackUrl = `https://workdrive.zoho.com/folder/${designFolder.id}`;
	log.info('Design folder: using fallback URL', { dealId, folderId: designFolder.id });
	return json({ url: fallbackUrl });
};
