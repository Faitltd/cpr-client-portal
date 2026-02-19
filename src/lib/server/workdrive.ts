import { env } from '$env/dynamic/private';

const WORKDRIVE_API_BASE = env.ZOHO_WORKDRIVE_API_BASE || '';
const WORKDRIVE_DOWNLOAD_BASE = env.ZOHO_WORKDRIVE_DOWNLOAD_BASE || '';

export type WorkDriveItem = {
	id: string;
	name: string;
	type: 'file' | 'folder' | 'unknown';
	size: number | null;
	mime: string | null;
	createdTime: string | null;
	modifiedTime: string | null;
	raw: any;
};

function getOriginFromApiDomain(apiDomain?: string) {
	if (apiDomain) return apiDomain.replace(/\/$/, '');
	const fallback = env.ZOHO_API_BASE || '';
	if (!fallback) return '';
	try {
		return new URL(fallback).origin;
	} catch {
		return '';
	}
}

export function getWorkDriveApiBase(apiDomain?: string) {
	if (WORKDRIVE_API_BASE) return WORKDRIVE_API_BASE.replace(/\/$/, '');
	const origin = getOriginFromApiDomain(apiDomain) || 'https://www.zohoapis.com';
	return `${origin}/WorkDrive/api/v1`;
}

export function getWorkDriveDownloadCandidates(apiDomain?: string) {
	const candidates = new Set<string>();
	if (WORKDRIVE_DOWNLOAD_BASE) {
		candidates.add(WORKDRIVE_DOWNLOAD_BASE.replace(/\/$/, ''));
	}

	const origin = getOriginFromApiDomain(apiDomain);
	if (origin) {
		try {
			const host = new URL(origin).hostname;
			const downloadHost = host
				.replace(/^www\.zohoapis\./, 'download.zoho.')
				.replace(/^zohoapis\./, 'download.zoho.');
			if (downloadHost && downloadHost !== host) {
				candidates.add(`https://${downloadHost}/v1/workdrive/download`);
			}
			const workdriveHost = host
				.replace(/^www\.zohoapis\./, 'workdrive.zoho.')
				.replace(/^zohoapis\./, 'workdrive.zoho.');
			if (workdriveHost && workdriveHost !== host) {
				candidates.add(`https://${workdriveHost}/api/v1/download`);
			}
		} catch {
			// ignore URL parsing issues
		}
	}

	candidates.add('https://workdrive.zoho.com/api/v1/download');
	candidates.add('https://download.zoho.com/v1/workdrive/download');

	return Array.from(candidates);
}

export async function workDriveCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {},
	apiDomain?: string
) {
	const base = getWorkDriveApiBase(apiDomain);
	const url = `${base}${endpoint}`;
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (!response.ok) {
		const error = await response.text().catch(() => '');
		throw new Error(`WorkDrive API call failed (${response.status}): ${error}`);
	}

	return response.json();
}

function normalizeWorkDriveType(raw: any) {
	const text = String(raw ?? '').toLowerCase();
	if (!text) return 'unknown' as const;
	if (text.includes('folder')) return 'folder' as const;
	if (text.includes('file')) return 'file' as const;
	if (text.includes('document')) return 'file' as const;
	return 'unknown' as const;
}

export function normalizeWorkDriveItem(item: any): WorkDriveItem {
	const attributes = item?.attributes || item || {};
	const idCandidate =
		attributes?.resource_id ??
		attributes?.file_id ??
		item?.resource_id ??
		item?.file_id ??
		attributes?.id ??
		item?.id ??
		'';
	const id = String(idCandidate).trim();
	const name = String(attributes?.name ?? item?.name ?? attributes?.display_name ?? '').trim();
	const typeRaw = attributes?.type ?? item?.type ?? attributes?.resource_type ?? attributes?.mime_type ?? '';
	let type = normalizeWorkDriveType(typeRaw);
	if (type === 'unknown') {
		if (attributes?.is_folder === true) type = 'folder';
		if (attributes?.isFolder === true) type = 'folder';
		if (item?.type === 'folders') type = 'folder';
		if (item?.type === 'files') type = 'file';
	}
	const size = Number(attributes?.size ?? attributes?.file_size ?? attributes?.size_in_bytes ?? 0);

	return {
		id,
		name,
		type,
		size: Number.isFinite(size) && size > 0 ? size : null,
		mime: typeof attributes?.mime_type === 'string' ? attributes.mime_type : null,
		createdTime: typeof attributes?.created_time === 'string' ? attributes.created_time : null,
		modifiedTime: typeof attributes?.modified_time === 'string' ? attributes.modified_time : null,
		raw: item
	};
}

export async function listWorkDriveFolder(
	accessToken: string,
	folderId: string,
	apiDomain?: string,
	options: { perPage?: number; maxPages?: number } = {}
) {
	const perPage = options.perPage ?? 200;
	const maxPages = options.maxPages ?? 5;
	const items: any[] = [];

	for (let page = 1; page <= maxPages; page += 1) {
		const params = new URLSearchParams({
			page: String(page),
			per_page: String(perPage)
		});
		const payload = await workDriveCall(
			accessToken,
			`/files/${encodeURIComponent(folderId)}/files?${params.toString()}`,
			{},
			apiDomain
		);
		const data = Array.isArray(payload?.data) ? payload.data : [];
		items.push(...data);
		const moreRecords = Boolean(payload?.info?.more_records);
		if (!moreRecords && data.length < perPage) break;
	}

	return items.map(normalizeWorkDriveItem);
}

export function isImageFile(item: WorkDriveItem) {
	const name = item?.name || '';
	const lower = name.toLowerCase();
	if (item?.mime && item.mime.startsWith('image/')) return true;
		return /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|tif|tiff)$/i.test(lower);
}

function normalizeName(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function extractWorkDriveFolderId(value: string | null | undefined) {
	if (!value) return '';
	const trimmed = String(value).trim();
	if (!trimmed) return '';
	const folderMatch = trimmed.match(/\/folders\/([a-z0-9]+)/i);
	if (folderMatch?.[1] && folderMatch[1].toLowerCase() !== 'files') {
		return folderMatch[1];
	}
	const resourceMatch = trimmed.match(/resource_id=([a-z0-9]+)/i);
	if (resourceMatch?.[1]) return resourceMatch[1];
	const folderIdMatch = trimmed.match(/folder_id=([a-z0-9]+)/i);
	if (folderIdMatch?.[1]) return folderIdMatch[1];
	const rawId = trimmed.match(/^[a-z0-9]{12,}$/i);
	if (rawId) return trimmed;
	return '';
}

export function buildDealFolderCandidates(dealName: string | null | undefined) {
	const candidates = new Set<string>();
	if (!dealName) return [];
	const trimmed = dealName.trim();
	if (!trimmed) return [];
	candidates.add(trimmed);

	const parts = trimmed.split(' - ');
	if (parts[0]) candidates.add(parts[0]);

	const withoutDate = trimmed.replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*/g, '').trim();
	if (withoutDate) candidates.add(withoutDate);

	return Array.from(candidates).filter(Boolean);
}

export function findBestFolderByName(items: WorkDriveItem[], candidates: string[]) {
	if (!Array.isArray(items) || items.length === 0) return null;
	const folders = items.filter((item) => item.type === 'folder');
	if (folders.length === 0) return null;

	const normalizedCandidates = candidates.map(normalizeName).filter(Boolean);
	if (normalizedCandidates.length === 0) return null;

	let best: WorkDriveItem | null = null;
	let bestScore = 0;
	for (const folder of folders) {
		const normalizedFolder = normalizeName(folder.name || '');
		if (!normalizedFolder) continue;
		for (const candidate of normalizedCandidates) {
			if (!candidate) continue;
			if (normalizedFolder === candidate) {
				return folder;
			}
			if (normalizedFolder.includes(candidate) || candidate.includes(normalizedFolder)) {
				const score = Math.min(normalizedFolder.length, candidate.length);
				if (score > bestScore) {
					bestScore = score;
					best = folder;
				}
			}
		}
	}
	return best;
}

export function findPhotosFolder(items: WorkDriveItem[]) {
	const folders = items.filter((item) => item.type === 'folder');
	if (folders.length === 0) return null;
	const normalizedTargets = ['photos', 'photo', 'progress photos', 'progress photo'];

	let best: WorkDriveItem | null = null;
	let bestScore = 0;
	for (const folder of folders) {
		const normalizedFolder = normalizeName(folder.name || '');
		if (!normalizedFolder) continue;
		for (const target of normalizedTargets) {
			if (normalizedFolder === target) return folder;
			if (normalizedFolder.includes(target)) {
				const score = target.length;
				if (score > bestScore) {
					bestScore = score;
					best = folder;
				}
			}
		}
	}
	return best;
}
