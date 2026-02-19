import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import {
	buildDealFolderCandidates,
	extractWorkDriveFolderId,
	findBestFolderByName,
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
const FIELD_UPDATES_FOLDER_NAMES = ['Field Updates'];
const DEFAULT_WORK_TYPE = 'Field Update';

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
	apiDomain?: string
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
	const photos: TradePhoto[] = [];

	for (const deal of Array.isArray(deals) ? deals : []) {
		const dealId = String(deal?.id || '').trim();
		const projectName = getDealLabel(deal) || (dealId ? `Deal ${dealId.slice(-6)}` : 'Project');
		const folderFromField = extractWorkDriveFolderId(deal?.Client_Portal_Folder);
		const candidates = buildDealFolderCandidates(projectName);

		let projectFolderId = folderFromField;
		if (!projectFolderId) {
			const projectFolder = findBestFolderByName(rootItems, candidates);
			projectFolderId = projectFolder?.id || '';
		}

		if (!projectFolderId) {
			console.warn('Trade photos missing WorkDrive project folder', {
				dealId,
				projectName,
				candidates
			});
			continue;
		}

		try {
			const projectItems = await listWorkDriveFolder(accessToken, projectFolderId, apiDomain);
			const fieldUpdatesFolder = findBestFolderByName(projectItems, FIELD_UPDATES_FOLDER_NAMES);
			if (!fieldUpdatesFolder) {
				console.warn('Trade photos missing Field Updates folder', {
					dealId,
					projectName,
					projectFolderId
				});
				continue;
			}

			const fieldItems = await listWorkDriveFolder(accessToken, fieldUpdatesFolder.id, apiDomain);
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
					workType: fieldUpdatesFolder.name || DEFAULT_WORK_TYPE,
					submittedAt,
					url,
					caption: toCaption(file.name)
				});
			}
		} catch (err) {
			console.warn('Trade photos failed to list Field Updates files', {
				dealId,
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

	const tradePartnerId = session.trade_partner.zoho_trade_partner_id;
	if (!tradePartnerId) {
		return json({ photos: [] });
	}

	try {
		const photos = await fetchTradePhotosForSession(tradePartnerId, accessToken, apiDomain);
		return json({ photos });
	} catch (err) {
		console.error('Trade photos failed', {
			tradePartnerId,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ message: 'Failed to load progress photos' }, { status: 500 });
	}
};
