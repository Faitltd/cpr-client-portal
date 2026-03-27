import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
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

async function createExternalShareLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const payload = {
		data: {
			attributes: {
				resource_id: resourceId,
				link_name: `design_folder_${resourceId}`,
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

	log.info('Design folder lookup: deal fields', {
		dealId,
		dealName: deal?.Deal_Name,
		clientPortalFolder: deal?.Client_Portal_Folder ? String(deal.Client_Portal_Folder).slice(0, 80) : null,
		externalLink: deal?.External_Link ? String(deal.External_Link).slice(0, 80) : null
	});

	// Resolve the project folder ID from Client_Portal_Folder or External_Link
	let projectFolderId = '';
	let folderSource = '';
	const folderField = deal?.Client_Portal_Folder || deal?.External_Link;

	if (folderField) {
		projectFolderId = extractWorkDriveFolderId(folderField) || '';
		if (projectFolderId) {
			folderSource = 'crm-field-id';
		} else {
			const hash = extractExternalLinkHash(folderField);
			if (hash) {
				projectFolderId = await resolveExternalLink(accessToken, hash, apiDomain) || '';
				if (projectFolderId) folderSource = 'external-link-resolved';
			}
		}
	}

	// Fallback: search root folder by deal name
	if (!projectFolderId) {
		const rootId = getRootFolderId();
		if (rootId) {
			const dealName = deal?.Deal_Name || accessibleDeal?.Deal_Name || '';
			const candidates = buildDealFolderCandidates(dealName);
			if (candidates.length > 0) {
				try {
					const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain);
					const match = findBestFolderByName(rootItems, candidates);
					if (match) {
						projectFolderId = match.id;
						folderSource = 'root-name-match';
					}
				} catch (err) {
					log.info('Design folder root search failed', { dealId, rootId, error: String(err) });
				}
			}
		}
	}

	if (!projectFolderId) {
		log.info('Design folder: project folder not found', {
			dealId,
			hasClientPortalFolder: !!deal?.Client_Portal_Folder,
			hasExternalLink: !!deal?.External_Link,
			hasRootFolder: !!getRootFolderId()
		});
		return json({ url: null, message: 'Project folder not found' });
	}

	// List project folder contents and find "Design and Planning" subfolder
	const items = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
	const designFolder = findDesignFolder(items);

	if (!designFolder) {
		const subfolders = items.filter((i) => i.type === 'folder').map((i) => i.name);
		log.info('Design folder not found in project folder', {
			dealId,
			projectFolderId,
			folderSource,
			subfolders
		});
		return json({ url: null, message: 'Design and Planning folder not found', subfolders });
	}

	// Create an external share link for the design folder
	const shareLink = await createExternalShareLink(accessToken, designFolder.id, apiDomain);

	if (shareLink) {
		log.info('Design folder share link created', { dealId, folderId: designFolder.id, folderSource });
		return json({ url: shareLink });
	}

	// If share link creation fails, construct a direct WorkDrive URL as fallback
	const fallbackUrl = `https://workdrive.zoho.com/folder/${designFolder.id}`;
	log.info('Design folder using fallback URL', { dealId, folderId: designFolder.id });
	return json({ url: fallbackUrl });
};
