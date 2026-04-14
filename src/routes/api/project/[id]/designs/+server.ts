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

/** Recursively scan any object for a zohoexternal.com URL string. */
function findExternalUrl(node: unknown, depth = 0): string | null {
	if (depth > 5 || node === null || node === undefined) return null;
	if (typeof node === 'string') {
		return /zohoexternal\.com/i.test(node) ? node : null;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findExternalUrl(item, depth + 1);
			if (found) return found;
		}
		return null;
	}
	if (typeof node === 'object') {
		for (const val of Object.values(node as Record<string, unknown>)) {
			const found = findExternalUrl(val, depth + 1);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Check folder metadata for an existing external (zohoexternal.com) share URL.
 */
async function getFolderPermalink(
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
		const attrs = data?.data?.attributes || {};
		const externalUrl = findExternalUrl(attrs);
		if (externalUrl) {
			log.info('designs getFolderPermalink: found external URL', { folderId, url: externalUrl });
			return externalUrl;
		}
		return null;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const { accessToken, apiDomain } = await getAccessToken();

	// Verify client has access to this deal
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '').trim() === dealId)) {
		throw error(403, 'Access denied to this project');
	}

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

	log.info('Client design folder lookup', { dealId, dealName });

	// ── Priority 1: CRM "Designs" field has a direct URL ──────────────
	const designsFieldValue = deal?.Designs;
	if (typeof designsFieldValue === 'string' && /^https?:\/\//i.test(designsFieldValue.trim())) {
		return json({ url: designsFieldValue.trim() });
	}

	// ── Priority 2: Find the design folder and get its external permalink ──
	let designFolderId = '';

	// If CRM Designs field has a WorkDrive folder ID or external link hash
	if (typeof designsFieldValue === 'string' && designsFieldValue.trim()) {
		const extracted = extractWorkDriveFolderId(designsFieldValue.trim());
		if (extracted) designFolderId = extracted;

		if (!designFolderId) {
			const hash = extractExternalLinkHash(designsFieldValue.trim());
			if (hash) {
				const resolved = await resolveExternalLink(accessToken, hash, apiDomain);
				if (resolved) designFolderId = resolved;
			}
		}
	}

	// Otherwise look up the project folder and find the design subfolder
	if (!designFolderId) {
		let projectFolderId = '';

		try {
			const cached = await getCachedFolder(dealId, 'root');
			if (cached) projectFolderId = cached.folderId;
		} catch {}

		if (!projectFolderId) {
			for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
				if (!field) continue;
				const extracted = extractWorkDriveFolderId(field) || '';
				if (extracted) { projectFolderId = extracted; break; }
			}
		}

		if (!projectFolderId) {
			for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
				if (!field) continue;
				const hash = extractExternalLinkHash(field);
				if (hash) {
					const resolved = await resolveExternalLink(accessToken, hash, apiDomain);
					if (resolved) { projectFolderId = resolved; break; }
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
							try { await setCachedFolder(dealId, 'root', match.id, match.name); } catch {}
						}
					} catch {}
				}
			}
		}

		if (!projectFolderId) {
			return json({ url: null, message: 'Project folder not found' });
		}

		const items = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
		const designFolder = findDesignFolder(items);
		if (!designFolder) {
			return json({ url: null, message: 'Design folder not found' });
		}
		designFolderId = designFolder.id;
	}

	// ── Get the external permalink for the design folder ──────────────
	const cacheKey = `${dealId}:designs`;

	// Check cache first
	try {
		const cached = await getCachedFolder(cacheKey, 'view-url');
		if (cached?.folderId) {
			return json({ url: cached.folderId });
		}
	} catch {}

	// Check folder metadata for an external share URL
	const externalUrl = await getFolderPermalink(accessToken, designFolderId, apiDomain);
	if (externalUrl) {
		try { await setCachedFolder(cacheKey, 'view-url', externalUrl); } catch {}
		return json({ url: externalUrl });
	}

	// Fall back to the WorkDrive folder URL — this requires Zoho login but
	// is scoped to just this design folder, not the entire drive.
	const folderUrl = `https://workdrive.zoho.com/folder/${designFolderId}`;
	return json({ url: folderUrl });
};
