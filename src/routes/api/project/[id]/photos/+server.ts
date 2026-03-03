import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getCachedFolder, setCachedFolder } from '$lib/server/folder-cache';
import { createLogger } from '$lib/server/logger';
import { getDealsForClient } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	buildDealFolderCandidates,
	extractExternalLinkHash,
	extractWorkDriveFolderId,
	findBestFolderByName,
	findPhotosFolder,
	getWorkDriveApiBase,
	isImageFile,
	listWorkDriveFolder,
	resolveExternalLink
} from '$lib/server/workdrive';

const log = createLogger('project-photos');

const WORKDRIVE_ROOT_FOLDER_VALUE = env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID || '';
const IMAGE_EXTENSIONS: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	heic: 'image/heic',
	heif: 'image/heif'
};

function getRootFolderId() {
	const parsed = extractWorkDriveFolderId(WORKDRIVE_ROOT_FOLDER_VALUE);
	if (parsed) return parsed;
	return WORKDRIVE_ROOT_FOLDER_VALUE.trim();
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function inferImageMime(name: string | null) {
	const trimmed = String(name || '').trim();
	if (!trimmed) return '';
	const ext = trimmed.split('.').pop()?.toLowerCase() || '';
	return IMAGE_EXTENSIONS[ext] || '';
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

async function getFolderPermalink(
	accessToken: string,
	folderId: string,
	apiDomain?: string
): Promise<{ url: string | null; debug: Record<string, unknown> }> {
	const base = getWorkDriveApiBase(apiDomain);
	const debug: Record<string, unknown> = { folderId, base };
	try {
		// Step A: Check folder metadata for any existing external URL (share_data, url_link, etc.)
		const response = await fetch(`${base}/files/${encodeURIComponent(folderId)}`, {
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			}
		});
		const rawBody = await response.text().catch(() => '');
		debug.metaStatus = response.status;
		debug.metaBody = rawBody.slice(0, 2000);
		if (response.ok) {
			let data: any = null;
			try { data = JSON.parse(rawBody); } catch { /* ignore */ }
			const attrs = data?.data?.attributes || {};
			debug.attrKeys = Object.keys(attrs);
			// Deep-scan ALL attribute values (includes share_data, url_link, shortcut_link, etc.)
			const deepUrl = findExternalUrl(attrs);
			if (deepUrl) {
				log.info('getFolderPermalink: found external URL in metadata', { folderId, url: deepUrl });
				return { url: deepUrl, debug };
			}
			debug.internalUrls = [attrs.permalink, attrs.url_link, attrs.shortcut_link]
				.filter((c) => typeof c === 'string' && /^https?:\/\//i.test(c));
		}

		// Step B: Fetch existing share links for this folder via GET /links
		try {
			const linksResp = await fetch(
				`${base}/links?filter[resource_id]=${encodeURIComponent(folderId)}`,
				{
					headers: {
						Authorization: `Zoho-oauthtoken ${accessToken}`,
						'Content-Type': 'application/json'
					}
				}
			);
			debug.linksStatus = linksResp.status;
			if (linksResp.ok) {
				const linksData = await linksResp.json().catch(() => null);
				debug.linksData = linksData;
				const links = Array.isArray(linksData?.data) ? linksData.data : [];
				for (const link of links) {
					const linkUrl =
						link?.attributes?.link_url ||
						link?.attributes?.permalink ||
						link?.attributes?.public_url;
					if (typeof linkUrl === 'string' && /zohoexternal\.com/i.test(linkUrl)) {
						log.info('getFolderPermalink: found external link via GET /links', { folderId, url: linkUrl });
						return { url: linkUrl, debug };
					}
					// Construct from link ID — same hash used in zohoexternal.com/external/{hash}
					const linkId = link?.id || link?.attributes?.link_id;
					if (linkId) {
						const constructed = `https://workdrive.zohoexternal.com/external/${linkId}`;
						log.info('getFolderPermalink: constructed URL from existing link', { folderId, linkId });
						return { url: constructed, debug };
					}
				}
			}
		} catch (linksErr) {
			debug.linksError = String(linksErr);
		}

		log.debug('getFolderPermalink: no external URL found', { folderId });
		return { url: null, debug };
	} catch (err) {
		debug.error = String(err);
		return { url: null, debug };
	}
}

async function createFolderViewLink(
	accessToken: string,
	folderId: string,
	apiDomain?: string
): Promise<{ url: string | null; debug: Record<string, unknown> }> {
	const base = getWorkDriveApiBase(apiDomain);
	const debug: Record<string, unknown> = { folderId, base };

	// Try multiple link_type + allow_download combos.
	// 'download' with allow_download:true mirrors how file download links are created successfully.
	const attempts = [
		{ linkType: 'viewer', allowDownload: false },
		{ linkType: 'external', allowDownload: false },
		{ linkType: 'view', allowDownload: false },
		{ linkType: 'download', allowDownload: true },
		{ linkType: 'download', allowDownload: false }
	];
	for (const { linkType, allowDownload } of attempts) {
		const payload = {
			data: {
				attributes: {
					resource_id: folderId,
					link_type: linkType,
					request_user_data: false,
					allow_download: allowDownload
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
			const rawBody = await response.text().catch(() => '');
			const attemptKey = `${linkType}_dl${allowDownload ? '1' : '0'}`;
			debug[`${attemptKey}_status`] = response.status;
			debug[`${attemptKey}_body`] = rawBody.slice(0, 400);

			if (!response.ok) {
				log.warn('createFolderViewLink: request failed', { folderId, linkType, allowDownload, status: response.status, body: rawBody.slice(0, 300) });
				continue;
			}
			let data: any = null;
			try { data = JSON.parse(rawBody); } catch { /* ignore */ }
			debug[`${attemptKey}_parsed`] = data;

			const attrs = data?.data?.attributes || {};
			// Only accept public external URLs — internal zoho.com URLs require login.
			const viewUrl = attrs.link_url || attrs.permalink || attrs.public_url || attrs.url || null;
			if (viewUrl && /zohoexternal\.com/i.test(String(viewUrl))) {
				log.info('createFolderViewLink: got external URL from attrs', { folderId, linkType, viewUrl });
				return { url: String(viewUrl).trim(), debug };
			}
			// download_url from an external link ends in /download — strip it to get folder view URL
			const downloadUrl: string | undefined = attrs.download_url;
			if (downloadUrl && /zohoexternal\.com/i.test(downloadUrl)) {
				const folderUrl = downloadUrl.replace(/\/download(\?.*)?$/, '');
				log.info('createFolderViewLink: derived external folder URL from download_url', { folderId, linkType, folderUrl });
				return { url: folderUrl, debug };
			}
			// The link ID (data.data.id) is the same hash used in zohoexternal.com/external/{hash}
			const linkId = data?.data?.id || attrs?.link_id || attrs?.linkId || null;
			if (linkId) {
				const externalUrl = `https://workdrive.zohoexternal.com/external/${linkId}`;
				log.info('createFolderViewLink: constructed URL from link ID', { folderId, linkType, linkId });
				return { url: externalUrl, debug };
			}
			log.warn('createFolderViewLink: no URL in response', { folderId, linkType, attrKeys: Object.keys(attrs), dataId: data?.data?.id });
		} catch (err) {
			debug[`${linkType}_error`] = String(err);
			log.warn('createFolderViewLink: error', { folderId, linkType, error: String(err) });
		}
	}
	return { url: null, debug };
}

async function createWorkDriveDownloadLink(
	accessToken: string,
	resourceId: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const url = `${base}/links`;
	const payload = {
		data: {
			attributes: {
				resource_id: resourceId,
				link_name: `client_photo_${resourceId}`,
				link_type: 'download',
				request_user_data: false,
				allow_download: true
			},
			type: 'links'
		}
	};
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json'
			},
			body: JSON.stringify(payload)
		});
		if (!response.ok) {
			log.debug('createWorkDriveDownloadLink: failed', { resourceId, status: response.status });
			return null;
		}
		const data = await response.json().catch(() => null);
		const downloadUrl = data?.data?.attributes?.download_url;
		if (!downloadUrl || typeof downloadUrl !== 'string') {
			log.debug('createWorkDriveDownloadLink: missing url', { resourceId });
			return null;
		}
		return downloadUrl;
	} catch {
		return null;
	}
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

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

	return { accessToken, apiDomain };
}

async function canClientAccessDeal(session: Awaited<ReturnType<typeof getSession>>, dealId: string) {
	if (!session?.client) return false;
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const rootFolderId = getRootFolderId();
	if (!rootFolderId) {
		throw error(500, 'ZOHO_WORKDRIVE_ROOT_FOLDER_ID is not configured');
	}

	if (!(await canClientAccessDeal(session, dealId))) {
		throw error(403, 'Access denied to this project');
	}

	const { accessToken, apiDomain } = await getAccessToken();

	const dealPayload = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent('Deal_Name,External_Link,Client_Portal_Folder')}`,
		{},
		apiDomain
	);
	const deal = dealPayload?.data?.[0];
	const dealName: string | null =
		typeof deal?.Deal_Name === 'string'
			? deal.Deal_Name
			: deal?.Deal_Name?.name || deal?.Deal_Name?.display_value || null;
	let rootItems: Awaited<ReturnType<typeof listWorkDriveFolder>> = [];
	const candidateNames = buildDealFolderCandidates(dealName);
	let projectFolderId = '';
	let projectFolderName: string | null = null;
	let folderSource: string = 'unknown';
	let externalLinkAttempted = false;
	let externalLinkResolved = false;

	try {
		const cached = await getCachedFolder(dealId, 'root');
		if (cached) {
			projectFolderId = cached.folderId;
			projectFolderName = cached.folderName ?? null;
			folderSource = 'cache';
			log.info('WorkDrive folder cache hit', {
				dealId,
				folderType: 'root',
				folderId: projectFolderId
			});
		}
	} catch {}

	if (!projectFolderId) {
		const folderFromField =
			extractWorkDriveFolderId(deal?.External_Link) ||
			extractWorkDriveFolderId(deal?.Client_Portal_Folder);
		if (folderFromField) {
			projectFolderId = folderFromField;
			projectFolderName = dealName || null;
			folderSource = 'crm-internal-url';
		} else {
			const externalHash =
				extractExternalLinkHash(deal?.External_Link) ||
				extractExternalLinkHash(deal?.Client_Portal_Folder);
			if (externalHash) {
				externalLinkAttempted = true;
				const resolved = await resolveExternalLink(accessToken, externalHash, apiDomain);
				if (resolved) {
					projectFolderId = resolved;
					projectFolderName = dealName || null;
					folderSource = 'crm-external-link';
					externalLinkResolved = true;
					log.info('WorkDrive folder resolved from external share link', {
						dealId,
						hashPrefix: externalHash.slice(0, 12),
						folderId: projectFolderId
					});
				} else {
					log.info('WorkDrive external link resolution failed — falling back to root name search', {
						dealId,
						hashPrefix: externalHash.slice(0, 12)
					});
				}
			} else {
				log.info('WorkDrive CRM fields not parseable — falling back to root name search', {
					dealId,
					externalLinkPresent: !!deal?.External_Link,
					clientPortalFolderPresent: !!deal?.Client_Portal_Folder
				});
			}
		}
		if (projectFolderId) {
			try {
				await setCachedFolder(dealId, 'root', projectFolderId, projectFolderName ?? undefined);
				log.info('WorkDrive root folder cached from CRM field', {
					dealId,
					folderSource,
					folderId: projectFolderId
				});
			} catch {}
		}
	}

	let projectFolder: { id: string; name: string | null } | null = null;
	if (!projectFolderId) {
		rootItems = await listWorkDriveFolder(accessToken, rootFolderId, apiDomain);
		projectFolder = findBestFolderByName(rootItems, candidateNames);
		if (!projectFolder) {
			const rootHasClientPortal = rootItems.some(
				(i) => i.type === 'folder' && /client.?portal/i.test(i.name || '')
			);
			if (rootHasClientPortal) {
				log.info('photos: rootFolderId appears to be the project folder itself', {
					dealId,
					rootFolderId
				});
				projectFolderId = rootFolderId;
				projectFolderName = dealName;
				projectFolder = { id: rootFolderId, name: dealName };
			} else {
				return json({
					dealId,
					dealName,
					source: 'workdrive',
					status: 'missing_project_folder',
					message: 'No matching project folder found under WorkDrive root folder.',
					candidates: candidateNames,
					rootFolderId,
					rootItemNames: rootItems.map((i) => `[${i.type}] ${i.name}`)
				});
			}
		}
		projectFolderId = projectFolder.id;
		projectFolderName = projectFolder.name || null;
		try {
			await setCachedFolder(dealId, 'root', projectFolderId, projectFolderName ?? undefined);
			log.debug('WorkDrive folder cache set', {
				dealId,
				folderType: 'root',
				folderId: projectFolderId
			});
		} catch {}
	} else {
		projectFolder = { id: projectFolderId, name: projectFolderName };
	}

	let projectItems: Awaited<ReturnType<typeof listWorkDriveFolder>> = [];
	let photosFolder: { id: string; name: string | null } | null = null;
	let photosFolderCacheHit = false;
	try {
		const cachedPhotos = await getCachedFolder(dealId, 'photos');
		if (cachedPhotos) {
			photosFolder = { id: cachedPhotos.folderId, name: cachedPhotos.folderName ?? null };
			photosFolderCacheHit = true;
			log.info('WorkDrive folder cache hit', {
				dealId,
				folderType: 'photos',
				folderId: cachedPhotos.folderId
			});
		}
	} catch {}

	if (!photosFolderCacheHit) {
		projectItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);

		// Always prefer "Client Portal" subfolder for client-facing photos.
		// Do NOT skip this lookup just because images exist at the project root —
		// those root-level files belong to other folders (Permits, Scope of Work, etc.)
		// and should not be served to clients.
		const clientPortalFolder = projectItems
			.filter((i) => i.type === 'folder')
			.find((f) => /client.?portal/i.test(f.name || ''));
		const resolvedPhotos = clientPortalFolder ?? findPhotosFolder(projectItems);
		photosFolder = resolvedPhotos
			? { id: resolvedPhotos.id, name: resolvedPhotos.name || null }
			: null;

		if (photosFolder) {
			try {
				await setCachedFolder(dealId, 'photos', photosFolder.id, photosFolder.name ?? undefined);
				log.debug('WorkDrive folder cache set', {
					dealId,
					folderType: 'photos',
					folderId: photosFolder.id
				});
			} catch {}
		}
	}

	const folderToUse = photosFolder || projectFolder;
	log.info('photos folder resolved', {
		dealId,
		projectFolderId: projectFolder.id,
		projectFolderName: projectFolder.name,
		photosFolderCacheHit,
		photosFolderId: photosFolder?.id ?? null,
		photosFolderName: photosFolder?.name ?? null,
		folderUsedId: folderToUse.id,
		folderUsedName: folderToUse.name
	});
	let photosItems = await listWorkDriveFolder(accessToken, folderToUse.id, apiDomain);
	let imageFiles = photosItems.filter((item) => item.type === 'file' && isImageFile(item));
	let effectiveFolderUsed = folderToUse;

	if (imageFiles.length === 0) {
		const subfolders = photosItems.filter((i) => i.type === 'folder');
		// Prioritize Photos-named folders, then scan remaining subfolders
		const orderedSubfolders = [
			...subfolders.filter((f) => /^(photos?|progress\s*photos?)$/i.test((f.name || '').trim())),
			...subfolders.filter((f) => !/^(photos?|progress\s*photos?)$/i.test((f.name || '').trim()))
		];
		for (const subfolder of orderedSubfolders) {
			try {
				const subItems = await listWorkDriveFolder(accessToken, subfolder.id, apiDomain);
				const subImages = subItems.filter((i) => i.type === 'file' && isImageFile(i));
				if (subImages.length > 0) {
					log.info('photos: found images in subfolder', {
						dealId,
						subfolder: { id: subfolder.id, name: subfolder.name },
						imageCount: subImages.length
					});
					photosItems = subItems;
					imageFiles = subImages;
					effectiveFolderUsed = { id: subfolder.id, name: subfolder.name || null };
					try { await setCachedFolder(dealId, 'photos', subfolder.id, subfolder.name ?? undefined); } catch {}
					break;
				}
			} catch { /* skip inaccessible subfolders */ }
		}
	}

	// Determine folder view URL — a public external WorkDrive URL for the "Client Portal" folder.
	// Priority: (1) cached URL, (2) permalink from folder metadata, (3) create new share link.
	let folderViewUrl: string | null = null;
	let folderViewLinkDebug: Record<string, unknown> | null = null;
	const viewLinkTargetFolder = photosFolder || projectFolder;
	const viewUrlCacheKey = `${dealId}:${viewLinkTargetFolder.id}`;

	// Step 1: cached URL
	try {
		const cachedView = await getCachedFolder(viewUrlCacheKey, 'view-url');
		if (cachedView?.folderId) folderViewUrl = cachedView.folderId;
	} catch {}

	// Step 2: fetch existing permalink from folder metadata (read-only, no link creation needed)
	if (!folderViewUrl) {
		const permalinkResult = await getFolderPermalink(accessToken, viewLinkTargetFolder.id, apiDomain);
		folderViewLinkDebug = { permalink: permalinkResult.debug };
		if (permalinkResult.url) {
			folderViewUrl = permalinkResult.url;
			await setCachedFolder(viewUrlCacheKey, 'view-url', permalinkResult.url);
		}
	}

	// Step 3: create a new share link as fallback
	if (!folderViewUrl) {
		try {
			const result = await createFolderViewLink(accessToken, viewLinkTargetFolder.id, apiDomain);
			folderViewLinkDebug = { ...(folderViewLinkDebug || {}), createLink: result.debug };
			if (result.url) {
				folderViewUrl = result.url;
				await setCachedFolder(viewUrlCacheKey, 'view-url', result.url);
			}
		} catch {}
	}

	// Build file list with WorkDrive shareable download links (same approach as trade partner photos)
	const files = await Promise.all(
		imageFiles.map(async (file) => {
			let fileUrl: string;
			try {
				const downloadLink = await createWorkDriveDownloadLink(accessToken, file.id, apiDomain);
				if (downloadLink) {
					fileUrl = downloadLink;
				} else {
					// Fallback to proxy if download link creation fails
					const qp = new URLSearchParams();
					if (file.name) qp.set('fileName', file.name);
					const inferred = file.mime || inferImageMime(file.name);
					if (inferred) qp.set('mime', inferred);
					const suffix = qp.toString() ? `?${qp.toString()}` : '';
					fileUrl = `/api/project/${encodeURIComponent(dealId)}/photos/${encodeURIComponent(file.id)}${suffix}`;
				}
			} catch {
				const qp = new URLSearchParams();
				if (file.name) qp.set('fileName', file.name);
				const inferred = file.mime || inferImageMime(file.name);
				if (inferred) qp.set('mime', inferred);
				const suffix = qp.toString() ? `?${qp.toString()}` : '';
				fileUrl = `/api/project/${encodeURIComponent(dealId)}/photos/${encodeURIComponent(file.id)}${suffix}`;
			}
			return {
				id: file.id,
				name: file.name,
				size: file.size,
				mime: file.mime,
				createdTime: file.createdTime,
				url: fileUrl
			};
		})
	);

	const debug = url.searchParams.get('debug') === '1';
	return json({
		dealId,
		dealName,
		folderViewUrl,
		source: 'workdrive',
		rootFolderId,
		projectFolder: { id: projectFolder.id, name: projectFolder.name },
		photosFolder: photosFolder ? { id: photosFolder.id, name: photosFolder.name } : null,
		_resolution: {
			folderSource,
			externalLinkAttempted,
			externalLinkResolved,
			photosFolderCacheHit,
			projectFolder: { id: projectFolder.id, name: projectFolder.name },
			photosFolder: photosFolder ? { id: photosFolder.id, name: photosFolder.name } : null,
			folderUsed: { id: effectiveFolderUsed.id, name: effectiveFolderUsed.name },
			folderViewLinkDebug,
			projectItemNames: projectItems.map((i) => `[${i.type}] ${i.name}`).slice(0, 30),
			photosItemNames: photosItems.map((i) => `[${i.type}] ${i.name}`).slice(0, 30)
		},
		files,
		debug: debug
			? {
					rootItems: rootItems.slice(0, 50),
					projectItems: projectItems.slice(0, 50),
					photosItems: photosItems.slice(0, 50)
				}
			: undefined
	});
};
