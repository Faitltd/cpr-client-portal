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
		`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent('Deal_Name,Client_Portal_Folder')}`,
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
	// Track how the folder was resolved for diagnostics
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
		const crmFieldValue = deal?.Client_Portal_Folder;
		const folderFromField = extractWorkDriveFolderId(crmFieldValue);
		if (folderFromField) {
			projectFolderId = folderFromField;
			projectFolderName = dealName || null;
			folderSource = 'crm-internal-url';
		} else {
			// Client_Portal_Folder may be an external share URL (zohoexternal.com/external/HASH).
			// Resolve the hash to an internal resource_id via the WorkDrive links API.
			const externalHash = extractExternalLinkHash(crmFieldValue);
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
				log.info('WorkDrive Client_Portal_Folder not parseable — falling back to root name search', {
					dealId,
					fieldPresent: !!crmFieldValue
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
			// Fallback: if the root folder itself contains a "Client Portal" subfolder,
			// ZOHO_WORKDRIVE_ROOT_FOLDER_ID is pointing directly at the deal folder.
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

		// If the project folder already contains image files directly, use it as-is.
		// This handles the case where Client_Portal_Folder CRM field points straight to
		// the photos folder (e.g. "Client Portal") rather than a parent container.
		const directImages = projectItems.filter((i) => i.type === 'file' && isImageFile(i));
		if (directImages.length === 0) {
			// No images directly here — look for a photos subfolder.
			// Prefer "Client Portal" folder; fall back to findPhotosFolder for "Photos" etc.
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
		// else: images are directly in projectFolder — folderToUse = projectFolder below
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

	// If no images directly in folderToUse, go one level deeper (e.g. Client Portal → Photos subfolder)
	if (imageFiles.length === 0) {
		const deeperFolder = findPhotosFolder(photosItems);
		if (deeperFolder) {
			log.info('photos: going one level deeper', {
				dealId,
				from: { id: folderToUse.id, name: folderToUse.name },
				into: { id: deeperFolder.id, name: deeperFolder.name }
			});
			const deepItems = await listWorkDriveFolder(accessToken, deeperFolder.id, apiDomain);
			const deepImages = deepItems.filter((item) => item.type === 'file' && isImageFile(item));
			if (deepImages.length > 0) {
				photosItems = deepItems;
				imageFiles = deepImages;
				effectiveFolderUsed = { id: deeperFolder.id, name: deeperFolder.name || null };
				// Cache the actual resolved subfolder so future requests skip traversal
				try {
					await setCachedFolder(dealId, 'photos', deeperFolder.id, deeperFolder.name ?? undefined);
				} catch {}
			}
		}
	}

	const debug = url.searchParams.get('debug') === '1';
	return json({
		dealId,
		dealName,
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
			projectItemNames: projectItems.map((i) => `[${i.type}] ${i.name}`).slice(0, 30),
			photosItemNames: photosItems.map((i) => `[${i.type}] ${i.name}`).slice(0, 30)
		},
		files: imageFiles.map((file) => {
			const params = new URLSearchParams();
			if (file.name) params.set('fileName', file.name);
			const inferred = file.mime || inferImageMime(file.name);
			if (inferred) params.set('mime', inferred);
			const suffix = params.toString() ? `?${params.toString()}` : '';
			return {
				id: file.id,
				name: file.name,
				size: file.size,
				mime: file.mime,
				createdTime: file.createdTime,
				url: `/api/project/${encodeURIComponent(dealId)}/photos/${encodeURIComponent(file.id)}${suffix}`
			};
		}),
		debug: debug
			? {
				rootItems: rootItems.slice(0, 50),
				projectItems: projectItems.slice(0, 50),
				photosItems: photosItems.slice(0, 50)
			}
			: undefined
	});
};
