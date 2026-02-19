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
		} catch (err) {
			console.warn('Trade photos failed to list WorkDrive root folder', {
				rootFolderId,
				error: err instanceof Error ? err.message : String(err)
			});
			rootItems = [];
		}
	}

	const deals = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const requestedDealId = dealId ? String(dealId).trim() : '';
	const photos: TradePhoto[] = [];

	for (const deal of Array.isArray(deals) ? deals : []) {
		const currentDealId = String(deal?.id || '').trim();
		if (requestedDealId && currentDealId !== requestedDealId) continue;
		const projectName =
			getDealLabel(deal) || (currentDealId ? `Deal ${currentDealId.slice(-6)}` : 'Project');
		const folderFromField =
			extractWorkDriveFolderId(deal?.External_Link) ||
			extractWorkDriveFolderId(deal?.Client_Portal_Folder);
		const candidates = buildDealFolderCandidates(projectName);
		console.info('TRADE_PHOTOS: deal start', {
			dealId: currentDealId,
			projectName,
			folderFromField
		});

		let projectFolderId = folderFromField;
		let resolvedFieldUpdates:
			| { folder: { id: string; name: string }; label: string }
			| null = null;

		const loadFieldUpdates = async (folderId: string) => {
			const resolved = await resolveFieldUpdatesFolder(accessToken, folderId, apiDomain);
			console.info('TRADE_PHOTOS: resolveFieldUpdatesFolder', {
				dealId: currentDealId,
				projectName,
				projectFolderId: folderId,
				success: Boolean(resolved),
				folderId: resolved?.folder?.id || null,
				folderName: resolved?.folder?.name || null
			});
			return resolved || null;
		};

		if (projectFolderId) {
			try {
				resolvedFieldUpdates = await loadFieldUpdates(projectFolderId);
			} catch (err) {
				console.warn('Trade photos failed to list WorkDrive project folder', {
					dealId: currentDealId,
					projectName,
					projectFolderId,
					error: err instanceof Error ? err.message : String(err)
				});
				resolvedFieldUpdates = null;
			}
		}

		if (!resolvedFieldUpdates) {
			const projectFolder = findBestFolderByName(rootItems, candidates);
			projectFolderId = projectFolder?.id || '';
			if (projectFolderId) {
				try {
					resolvedFieldUpdates = await loadFieldUpdates(projectFolderId);
				} catch (err) {
					console.warn('Trade photos fallback project folder lookup failed', {
						dealId: currentDealId,
						projectName,
						projectFolderId,
						error: err instanceof Error ? err.message : String(err)
					});
				}
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
			console.info('TRADE_PHOTOS: fallback to project folder for images', {
				dealId: currentDealId,
				projectName,
				projectFolderId
			});

			try {
				const directItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
				const imageFiles = directItems.filter((item) => item.type === 'file' && isImageFile(item));

				console.info('TRADE_PHOTOS: direct folder scan result', {
					dealId: currentDealId,
					totalItems: directItems.length,
					imageCount: imageFiles.length
				});

				for (const file of imageFiles) {
					const submittedAt =
						toIsoOrNull(file.createdTime) ||
						toIsoOrNull(file.modifiedTime) ||
						new Date().toISOString();

					const publicUrl = extractWorkDrivePublicUrl(file);
					const url = publicUrl || `/api/trade/photos?fileId=${encodeURIComponent(file.id)}`;

					photos.push({
						id: file.id,
						projectName,
						workType: DEFAULT_WORK_TYPE,
						submittedAt,
						url,
						caption: toCaption(file.name)
					});
				}
			} catch (err) {
				console.warn('Trade photos fallback direct scan failed', {
					dealId: currentDealId,
					projectName,
					projectFolderId,
					error: err instanceof Error ? err.message : String(err)
				});
			}

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
				const publicUrl = extractWorkDrivePublicUrl(file);
				const url =
					publicUrl ||
					`/api/trade/photos?fileId=${encodeURIComponent(file.id)}`;
				photos.push({
					id: file.id,
					projectName,
					workType: fieldUpdatesLabel,
					submittedAt,
					url,
					caption: toCaption(file.name)
				});
			}
		} catch (err) {
			console.warn('Trade photos failed to list Field Updates files', {
				dealId: currentDealId,
				projectName,
				projectFolderId,
				error: err instanceof Error ? err.message : String(err)
			});
		}
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
		const candidates = getWorkDriveDownloadCandidates(apiDomain);
		let lastStatus = 500;
		let lastMessage = '';

		for (const base of candidates) {
			const downloadUrl = `${base.replace(/\/$/, '')}/${encodeURIComponent(fileId)}`;
			const response = await fetch(downloadUrl, {
				method: 'GET',
				headers: {
					Authorization: `Zoho-oauthtoken ${accessToken}`
				}
			});

			if (!response.ok) {
				lastStatus = response.status;
				lastMessage = await response.text().catch(() => '');
				continue;
			}

			const headers = new Headers();
			const contentType = response.headers.get('content-type') || 'application/octet-stream';
			headers.set('Content-Type', contentType);
			const disposition = response.headers.get('content-disposition');
			if (disposition) headers.set('Content-Disposition', disposition);

			return new Response(response.body, {
				status: response.status,
				headers
			});
		}

		return json({ message: lastMessage || 'Failed to download WorkDrive file' }, { status: lastStatus });
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
