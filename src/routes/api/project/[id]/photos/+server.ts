import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
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
		`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent('Deal_Name')}`,
		{},
		apiDomain
	);
	const deal = dealPayload?.data?.[0];
	const dealName: string | null =
		typeof deal?.Deal_Name === 'string'
			? deal.Deal_Name
			: deal?.Deal_Name?.name || deal?.Deal_Name?.display_value || null;

	const rootItems = await listWorkDriveFolder(accessToken, rootFolderId, apiDomain);
	const candidateNames = buildDealFolderCandidates(dealName);
	const projectFolder = findBestFolderByName(rootItems, candidateNames);
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

	const projectItems = await listWorkDriveFolder(accessToken, projectFolder.id, apiDomain);
	const photosFolder = findPhotosFolder(projectItems);
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
