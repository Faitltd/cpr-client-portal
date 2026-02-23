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
	extractWorkDriveFolderId,
	findBestFolderByName,
	findPhotosFolder,
	isImageFile,
	listWorkDriveFolder
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
	try {
		const cached = await getCachedFolder(dealId, 'root');
		if (cached) {
			projectFolderId = cached.folderId;
			projectFolderName = cached.folderName ?? null;
			log.info('WorkDrive folder cache hit', {
				dealId,
				folderType: 'root',
				folderId: projectFolderId
			});
		}
	} catch {}

	if (!projectFolderId) {
		const folderFromField = extractWorkDriveFolderId(deal?.Client_Portal_Folder);
		if (folderFromField) {
			projectFolderId = folderFromField;
			projectFolderName = dealName || null;
			try {
				await setCachedFolder(dealId, 'root', projectFolderId, projectFolderName ?? undefined);
				log.debug('WorkDrive folder set from Client_Portal_Folder CRM field', {
					dealId,
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
			return json({
				dealId,
				dealName,
				source: 'workdrive',
				status: 'missing_project_folder',
				message: 'No matching project folder found under WorkDrive root folder.',
				candidates: candidateNames,
				rootFolderId
			});
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
		const resolvedPhotos = findPhotosFolder(projectItems);
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
	const photosItems = await listWorkDriveFolder(accessToken, folderToUse.id, apiDomain);
	const imageFiles = photosItems.filter((item) => item.type === 'file' && isImageFile(item));

	const debug = url.searchParams.get('debug') === '1';
	return json({
		dealId,
		dealName,
		source: 'workdrive',
		rootFolderId,
		projectFolder: { id: projectFolder.id, name: projectFolder.name },
		photosFolder: photosFolder ? { id: photosFolder.id, name: photosFolder.name } : null,
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
