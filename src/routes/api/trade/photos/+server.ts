import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import {
	buildDealFolderCandidates,
	extractWorkDriveFolderId,
	findBestFolderByName,
	findPhotosFolder,
	getWorkDriveDownloadCandidates,
	isImageFile,
	listWorkDriveFolder
} from '$lib/server/workdrive';
import type { RequestHandler } from './$types';

type TradePhoto = {
	id: string;
	projectName: string;
	workType: string;
	submittedAt: string;
	url: string;
	caption?: string;
};

const WORKDRIVE_ROOT_FOLDER_VALUE = env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID || '';
const FIELD_UPDATES_FOLDER_NAMES = ['Field Updates', 'Field Update', 'FieldUpdates'];
const DEFAULT_WORK_TYPE = 'Field Update';
const MAX_FIELD_UPDATES_SCAN = 20;
const buildTradePhotoProxyUrl = (fileId: string) =>
	`/api/trade/photos?fileId=${encodeURIComponent(fileId)}`;

function getRootFolderId() {
	const parsed = extractWorkDriveFolderId(WORKDRIVE_ROOT_FOLDER_VALUE);
	if (parsed) return parsed;
	return WORKDRIVE_ROOT_FOLDER_VALUE.trim();
}

function toIsoOrNull(value?: string | null) {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function toCaption(name: string) {
	const trimmed = String(name || '').trim();
	if (!trimmed) return undefined;
	const withoutExtension = trimmed.replace(/\.[^/.]+$/, '').trim();
	return withoutExtension || undefined;
}

function getDealLabel(deal: any) {
	return (
		deal?.Deal_Name ||
		deal?.Potential_Name ||
		deal?.Name ||
		deal?.name ||
		deal?.Subject ||
		deal?.Full_Name ||
		deal?.Display_Name ||
		deal?.display_name ||
		null
	);
}

function isHttpUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function extractWorkDrivePublicUrl(item: any): string | null {
	if (!item) return null;
	const raw = item.raw || item;
	const attributes = raw?.attributes || raw;
	const candidates = [
		attributes?.download_url,
		attributes?.downloadUrl,
		attributes?.preview_url,
		attributes?.previewUrl,
		attributes?.permalink,
		attributes?.public_link,
		attributes?.publicLink,
		attributes?.public_url,
		attributes?.publicUrl,
		attributes?.url,
		attributes?.href,
		attributes?.link,
		attributes?.share_url,
		attributes?.shareUrl,
		attributes?.short_url,
		attributes?.shortUrl,
		raw?.download_url,
		raw?.downloadUrl,
		raw?.preview_url,
		raw?.previewUrl,
		raw?.permalink,
		raw?.public_link,
		raw?.publicLink,
		raw?.public_url,
		raw?.publicUrl,
		raw?.url,
		raw?.href,
		raw?.link,
		raw?.share_url,
		raw?.shareUrl,
		raw?.short_url,
		raw?.shortUrl
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && isHttpUrl(candidate)) return candidate;
	}
	return null;
}

function findFieldUpdatesFolder(items: Awaited<ReturnType<typeof listWorkDriveFolder>>) {
	return findBestFolderByName(items, FIELD_UPDATES_FOLDER_NAMES);
}

async function resolveFieldUpdatesFolder(
	accessToken: string,
	projectFolderId: string,
	apiDomain?: string
): Promise<{ folder: { id: string; name: string }; label: string } | null> {
	const projectItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
	const directMatch = findFieldUpdatesFolder(projectItems);
	if (directMatch) {
		return { folder: directMatch, label: directMatch.name || DEFAULT_WORK_TYPE };
	}

	const photosFolder = findPhotosFolder(projectItems);
	if (photosFolder) {
		const photosItems = await listWorkDriveFolder(accessToken, photosFolder.id, apiDomain);
		const photosMatch = findFieldUpdatesFolder(photosItems);
		if (photosMatch) {
			return { folder: photosMatch, label: photosMatch.name || DEFAULT_WORK_TYPE };
		}
	}

	const childFolders = projectItems.filter((item) => item.type === 'folder').slice(0, MAX_FIELD_UPDATES_SCAN);
	for (const child of childFolders) {
		try {
			const childItems = await listWorkDriveFolder(accessToken, child.id, apiDomain);
			const childMatch = findFieldUpdatesFolder(childItems);
			if (childMatch) {
				return { folder: childMatch, label: childMatch.name || DEFAULT_WORK_TYPE };
			}
		} catch {
			// ignore per-folder errors and keep scanning
		}
	}

	return null;
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

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw new Error('Zoho tokens not configured');
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

async function fetchTradePhotosForSession(
	tradePartnerId: string,
	accessToken: string,
	apiDomain?: string,
	dealId?: string | null
): Promise<TradePhoto[]> {
	const rootFolderId = getRootFolderId();
	let rootItems: Awaited<ReturnType<typeof listWorkDriveFolder>> = [];

	if (rootFolderId) {
		try {
			rootItems = await listWorkDriveFolder(accessToken, rootFolderId, apiDomain);
		} catch {
			rootItems = [];
		}
	}

	const allDeals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const requestedDealId = dealId ? String(dealId).trim() : '';
	const deals = Array.isArray(allDeals) ? allDeals : [];
	const filteredDeals = requestedDealId
		? deals.filter((deal) => String(deal?.id || '').trim() === requestedDealId)
		: deals;
	const photos: TradePhoto[] = [];

	for (const deal of deals) {
		const currentDealId = String(deal?.id || '').trim();
		if (requestedDealId && currentDealId !== requestedDealId) continue;
		const projectName =
			getDealLabel(deal) || (currentDealId ? `Deal ${currentDealId.slice(-6)}` : 'Project');
		const dealPhotoStart = photos.length;
		let warnedNoImages = false;
		const folderFromField =
			extractWorkDriveFolderId(deal?.External_Link) ||
			extractWorkDriveFolderId(deal?.Client_Portal_Folder);
		const candidates = buildDealFolderCandidates(projectName);

		let projectFolderId = folderFromField;
		let resolvedFieldUpdates:
			| { folder: { id: string; name: string }; label: string }
			| null = null;
		const warnNoImages = () => {
			if (warnedNoImages) return;
			if (projectFolderId && photos.length === dealPhotoStart) {
				console.warn('[TRADE PHOTOS] no images found', {
					dealId: currentDealId,
					projectName,
					projectFolderId
				});
				warnedNoImages = true;
			}
		};

		const loadFieldUpdates = async (folderId: string) => {
			const resolved = await resolveFieldUpdatesFolder(accessToken, folderId, apiDomain);
			return resolved || null;
		};

		if (projectFolderId) {
			try {
				resolvedFieldUpdates = await loadFieldUpdates(projectFolderId);
			} catch {
				resolvedFieldUpdates = null;
			}
		}

		if (!resolvedFieldUpdates) {
			const projectFolder = findBestFolderByName(rootItems, candidates);
			if (projectFolder?.id) projectFolderId = projectFolder.id;
			if (projectFolderId) {
				try {
					resolvedFieldUpdates = await loadFieldUpdates(projectFolderId);
				} catch {}
			}
		}

				if (!projectFolderId) {
			console.warn('TRADE_PHOTOS: no project folder found', {
				dealId: currentDealId,
				projectName,
				candidates,
				externalLink: deal?.External_Link
			});
			continue;
		}

		if (!resolvedFieldUpdates) {
			// Fallback: scan the project folder directly for image files
			try {
				const directItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
				const imageFiles = directItems.filter((item) => item.type === 'file' && isImageFile(item));

				for (const file of imageFiles) {
					const submittedAt =
						toIsoOrNull(file.createdTime) ||
						toIsoOrNull(file.modifiedTime) ||
						new Date().toISOString();

					
					const url = buildTradePhotoProxyUrl(file.id);

					photos.push({
						id: file.id,
						projectName,
						workType: DEFAULT_WORK_TYPE,
						submittedAt,
						url,
						caption: toCaption(file.name)
					});
				}
			} catch {}

			warnNoImages();
			continue;
		}

		try {
			const fieldUpdatesFolder = resolvedFieldUpdates.folder;
			const fieldUpdatesLabel = resolvedFieldUpdates.label || DEFAULT_WORK_TYPE;
			const fieldItems = await listWorkDriveFolder(
				accessToken,
				fieldUpdatesFolder.id,
				apiDomain
			);
			const imageFiles = fieldItems.filter((item) => item.type === 'file' && isImageFile(item));

			for (const file of imageFiles) {
				const submittedAt =
					toIsoOrNull(file.createdTime) ||
					toIsoOrNull(file.modifiedTime) ||
					new Date().toISOString();
				
					const url = buildTradePhotoProxyUrl(file.id);
				photos.push({
					id: file.id,
					projectName,
					workType: fieldUpdatesLabel,
					submittedAt,
					url,
					caption: toCaption(file.name)
				});
			}
		} catch {}

		warnNoImages();
	}

	photos.sort((a, b) => {
		const aDate = new Date(a.submittedAt).getTime();
		const bDate = new Date(b.submittedAt).getTime();
		return bDate - aDate;
	});

	return photos;
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	let accessToken = '';
	let apiDomain: string | undefined;
	try {
		const tokenData = await getAccessToken();
		accessToken = tokenData.accessToken;
		apiDomain = tokenData.apiDomain;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Zoho tokens not configured';
		return json({ message }, { status: 500 });
	}

	const fileId = url.searchParams.get('fileId');
	if (fileId) {
		const metaResponse = await fetch(
			`https://www.zohoapis.com/workdrive/api/v1/files/${encodeURIComponent(fileId)}`,
			{
				headers: {
					Authorization: `Zoho-oauthtoken ${accessToken}`
				}
			}
		);
		console.warn('[TRADE PHOTOS] meta sample', {
			fileId,
			ok: metaResponse.ok,
			status: metaResponse.status,
			metaSample: await metaResponse
				.clone()
				.text()
				.then((text) => text.slice(0, 400))
				.catch(() => '')
		});
		if (!metaResponse.ok) {
			console.warn('[TRADE PHOTOS] could not resolve download URL', { fileId });
			return json({ message: 'File not found' }, { status: 404 });
		}

		const metaJson = await metaResponse.json().catch(() => null);
		if (!metaJson) {
			console.warn('[TRADE PHOTOS] could not resolve download URL', { fileId });
			return json({ message: 'File not found' }, { status: 404 });
		}

		const attributes = metaJson?.data?.attributes || metaJson?.data?.[0]?.attributes || {};
		const resourceId =
			attributes?.resource_id ||
			attributes?.resourceId ||
			metaJson?.data?.id ||
			metaJson?.data?.[0]?.id;
		let downloadUrl: string | undefined =
			attributes?.download_url || attributes?.downloadUrl || undefined;
		let fromField = downloadUrl ? 'attributes.download_url' : '';

		if (!downloadUrl && resourceId) {
			const candidates = getWorkDriveDownloadCandidates(apiDomain);
			if (candidates.length) {
				downloadUrl = `${candidates[0].replace(/\/$/, '')}/${encodeURIComponent(resourceId)}`;
				fromField = 'attributes.resource_id';
			}
		}

		if (downloadUrl && !downloadUrl.includes('directDownload=')) {
			const joiner = downloadUrl.includes('?') ? '&' : '?';
			downloadUrl = `${downloadUrl}${joiner}directDownload=true`;
			if (fromField === 'attributes.download_url') {
				fromField = 'attributes.download_url+directDownload';
			}
		}
		if (!downloadUrl || typeof downloadUrl !== 'string') {
			console.warn('[TRADE PHOTOS] no download_url in metadata', { fileId, meta: metaJson });
			return json({ message: 'No download URL' }, { status: 502 });
		}
		console.warn('[TRADE PHOTOS] using download URL', {
			fileId,
			fromField,
			downloadUrl
		});

		const imageResponse = await fetch(downloadUrl, {
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`
			}
		});

		if (!imageResponse.ok) {
			const errorBody = await imageResponse.text().catch(() => '');
			console.warn('[TRADE PHOTOS] download failed', {
				fileId,
				status: imageResponse.status,
				body: errorBody.slice(0, 200)
			});
			return json({ message: 'Download failed' }, { status: imageResponse.status });
		}

		const headers = new Headers();
		const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
		headers.set('Content-Type', contentType);
		headers.set('Content-Disposition', 'inline');
		console.warn('[TRADE PHOTOS] streaming image', {
			fileId,
			status: imageResponse.status,
			contentType
		});

		return new Response(imageResponse.body, {
			status: 200,
			headers
		});
	}

	const dealId = url.searchParams.get('dealId');
	const tradePartnerId = session.trade_partner.zoho_trade_partner_id;
	if (!tradePartnerId) {
		return json({ photos: [] });
	}

	try {
		const photos = await fetchTradePhotosForSession(tradePartnerId, accessToken, apiDomain, dealId);
		return json({ photos });
	} catch (err) {
		console.error('Trade photos failed', {
			tradePartnerId,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ message: 'Failed to load progress photos' }, { status: 500 });
	}
};
