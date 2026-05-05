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

const log = createLogger('trade-sow');
const WORKDRIVE_ROOT_FOLDER_VALUE = env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID || '';
const DESIGN_FOLDER_NAMES = ['design and planning', 'design & planning', 'designs and planning'];
const SOW_FOLDER_NAMES = ['sow', 'scope of work', 'scopes', 'scope'];
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

function findFolderByNames(
	items: { id: string; name: string; type: string }[],
	targets: string[]
) {
	const folders = items.filter((i) => i.type === 'folder');
	for (const target of targets) {
		const match = folders.find((f) => normalizeName(f.name) === target);
		if (match) return match;
	}
	for (const target of targets) {
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

async function createExternalShareLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const shortId = resourceId.slice(-12);
	const payload = {
		data: {
			attributes: {
				resource_id: resourceId,
				link_name: `sow_${shortId}`,
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
	const tradePartnerId = String(session.trade_partner?.zoho_trade_partner_id || '').trim();
	if (!tradePartnerId) throw error(403, 'No linked trade partner');

	const dealId = String(params.dealId || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const { accessToken, apiDomain } = await getAccessToken();

	const dealList = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const accessibleDeal = dealList.find((item: any) => String(item?.id || '').trim() === dealId);
	if (!accessibleDeal) throw error(403, 'Access denied to this project');

	const dealFields = 'Deal_Name,Client_Portal_Folder,External_Link,SOW_External_Link';
	const dealResponse = await zohoApiCall(
		accessToken,
		`/Deals/${dealId}?fields=${encodeURIComponent(dealFields)}`,
		{},
		apiDomain
	);
	const deal = dealResponse?.data?.[0];
	const dealName = deal?.Deal_Name || accessibleDeal?.Deal_Name || '';

	// Prefer the SOW_External_Link custom field if populated. Admins paste a manually-created
	// WorkDrive external share URL there because the /links API rejects automated share creation.
	const sowExternalLink = String(deal?.SOW_External_Link || '').trim();
	if (sowExternalLink && /^https?:\/\//i.test(sowExternalLink)) {
		log.info('SOW: using SOW_External_Link from CRM', { dealId });
		return json({ url: sowExternalLink });
	}

	log.info('SOW folder lookup', {
		dealId,
		dealName,
		clientPortalFolder: deal?.Client_Portal_Folder ? String(deal.Client_Portal_Folder).slice(0, 100) : null,
		externalLink: deal?.External_Link ? String(deal.External_Link).slice(0, 100) : null
	});

	// ── Step 1: Locate the project folder (cache → CRM fields → external link → name search) ─
	let projectFolderId = '';
	let folderSource = '';

	try {
		const cached = await getCachedFolder(dealId, 'root');
		if (cached) {
			projectFolderId = cached.folderId;
			folderSource = 'cache';
		}
	} catch {}

	if (!projectFolderId) {
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const extracted = extractWorkDriveFolderId(field) || '';
			if (extracted) {
				projectFolderId = extracted;
				folderSource = 'crm-field-id';
				break;
			}
		}
	}

	if (!projectFolderId) {
		for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
			if (!field) continue;
			const hash = extractExternalLinkHash(field);
			if (hash) {
				const resolved = await resolveExternalLink(accessToken, hash, apiDomain);
				if (resolved) {
					projectFolderId = resolved;
					folderSource = 'external-link-resolved';
					break;
				}
			}
		}
	}

	if (!projectFolderId) {
		const rootId = getRootFolderId();
		if (rootId) {
			const candidates = buildDealFolderCandidates(dealName);
			if (candidates.length > 0) {
				try {
					let searchFolderId = rootId;
					const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain);

					if (looksLikeProjectContents(rootItems)) {
						const parentId = await getParentFolderId(accessToken, rootId, apiDomain);
						if (parentId) searchFolderId = parentId;
					}

					const parentItems = searchFolderId !== rootId
						? await listWorkDriveFolder(accessToken, searchFolderId, apiDomain)
						: rootItems;

					const match = findBestFolderByName(parentItems, candidates);
					if (match) {
						projectFolderId = match.id;
						folderSource = 'name-match';
						try { await setCachedFolder(dealId, 'root', match.id, match.name); } catch {}
					}
				} catch (err) {
					log.info('SOW: root search failed', { dealId, error: String(err) });
				}
			}
		}
	}

	if (!projectFolderId) {
		log.info('SOW: project folder not found', { dealId, dealName });
		return json({ url: null, message: 'Project folder not found' });
	}

	if (folderSource !== 'cache') {
		try { await setCachedFolder(dealId, 'root', projectFolderId); } catch {}
	}

	// ── Step 2: Find "Design and Planning" subfolder ────────────────────
	// Do NOT drill into "Designs" subfolder — SOW lives directly under Design and Planning.
	const projectItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
	const designFolder = findFolderByNames(projectItems, DESIGN_FOLDER_NAMES);

	if (!designFolder) {
		log.info('SOW: Design and Planning folder not found', { dealId });
		return json({ url: null, message: 'Design and Planning folder not found' });
	}

	// ── Step 3: Find "SOW" subfolder inside Design and Planning ─────────
	const designItems = await listWorkDriveFolder(accessToken, designFolder.id, apiDomain);
	const sowFolder = findFolderByNames(designItems, SOW_FOLDER_NAMES);

	if (!sowFolder) {
		const subfolders = designItems.filter((i) => i.type === 'folder').map((i) => i.name);
		log.info('SOW: SOW folder not found', { dealId, designFolderId: designFolder.id, subfolders });
		return json({ url: null, message: 'SOW folder not found', subfolders });
	}

	// ── Step 4: Create external share link or fallback ──────────────────
	const shareLink = await createExternalShareLink(accessToken, sowFolder.id, apiDomain);
	if (shareLink) {
		log.info('SOW: share link created', { dealId, folderId: sowFolder.id });
		return json({ url: shareLink });
	}

	const fallbackUrl = `https://workdrive.zoho.com/folder/${sowFolder.id}`;
	log.info('SOW: using fallback URL', { dealId, folderId: sowFolder.id });
	return json({ url: fallbackUrl });
};
