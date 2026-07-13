import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const WORKDRIVE_API_BASE = env.ZOHO_WORKDRIVE_API_BASE || '';
const WORKDRIVE_DOWNLOAD_BASE = env.ZOHO_WORKDRIVE_DOWNLOAD_BASE || '';
const log = createLogger('workdrive');

export type WorkDriveItem = {
	id: string;
	name: string;
	type: 'file' | 'folder' | 'unknown';
	size: number | null;
	mime: string | null;
	createdTime: string | null;
	modifiedTime: string | null;
	permalink: string | null;
	raw: any;
};

function getOriginFromApiDomain(apiDomain?: string) {
	if (apiDomain && apiDomain !== 'default') {
		try {
			return new URL(apiDomain).origin;
		} catch {
			return apiDomain.replace(/\/$/, '');
		}
	}
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
	return `${origin}/workdrive/api/v1`;
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
	// Anything else with a non-empty resource-type string is a leaf node we
	// should attempt to ingest. Zoho-native types (zsheet, zw, zshow, etc.)
	// don't contain "file" in the string, so the earlier file-only check was
	// too narrow. Be permissive: not-folder => file; pickSource is the gate
	// that decides what we actually parse.
	return 'file' as const;
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

	// Permalink: the file's web URL in WorkDrive. The API field is usually
	// `permalink`, but some payload variants use `web_url`. Fall back to the
	// canonical /file/{id} pattern when neither is present.
	const permalinkRaw =
		(typeof attributes?.permalink === 'string' && attributes.permalink) ||
		(typeof attributes?.web_url === 'string' && attributes.web_url) ||
		(typeof item?.permalink === 'string' && item.permalink) ||
		null;
	const permalink =
		permalinkRaw && permalinkRaw.trim()
			? permalinkRaw.trim()
			: id
				? `https://workdrive.zoho.com/file/${encodeURIComponent(id)}`
				: null;

	return {
		id,
		name,
		type,
		size: Number.isFinite(size) && size > 0 ? size : null,
		mime: typeof attributes?.mime_type === 'string' ? attributes.mime_type : null,
		createdTime: typeof attributes?.created_time === 'string' ? attributes.created_time : null,
		modifiedTime: typeof attributes?.modified_time === 'string' ? attributes.modified_time : null,
		permalink,
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
	const base = getWorkDriveApiBase(apiDomain);
	const previewParams = new URLSearchParams({
		'page[limit]': String(perPage),
		'page[offset]': '0'
	});
	const previewUrl = `${base}/files/${encodeURIComponent(folderId)}/files?${previewParams.toString()}`;
	log.debug('WORKDRIVE listFolder request', {
		folderId,
		apiDomain: apiDomain || null,
		previewUrl,
		perPage,
		maxPages
	});

	for (let page = 1; page <= maxPages; page += 1) {
		const params = new URLSearchParams({
			'page[limit]': String(perPage),
			'page[offset]': String((page - 1) * perPage)
		});
		const url = `${base}/files/${encodeURIComponent(folderId)}/files?${params.toString()}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			const responseText = await response.text().catch(() => '');
			log.error('WORKDRIVE listFolder response', {
				status: response.status,
				contentType: response.headers.get('content-type'),
				bodyPreview: responseText.slice(0, 200)
			});
			throw new Error(`WorkDrive API call failed (${response.status}): ${responseText}`);
		}

		const payload = await response.json();
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

export function extractWorkDriveFolderId(value: unknown) {
	const seen = new WeakSet<object>();

	const extractFromString = (input: string) => {
		const trimmed = input.trim();
		log.debug('WORKDRIVE raw input', {
			length: trimmed.length,
			hasProtocol: /^[a-z]+:\/\//i.test(trimmed),
			looksLikeId: /^[a-z0-9]{12,}$/i.test(trimmed),
			hasFolderPath: /\/folders?\//i.test(trimmed)
		});
		if (!trimmed) return '';

		try {
			const url = new URL(trimmed);
			const pathTokens = url.pathname.split('/').filter(Boolean);
			const idx = pathTokens.findIndex((token) => {
				const k = token.toLowerCase();
				return k === 'folder' || k === 'folders';
			});
			const folderId = idx >= 0 ? pathTokens[idx + 1] || '' : '';
			if (folderId.trim()) {
				log.debug('WORKDRIVE extract id', { folderId: folderId.trim(), source: 'path' });
				return folderId.trim();
			}
			// Handle one.zoho.com/...workdrive/{id} URLs
			const wdIdx = pathTokens.findIndex((t) => t.toLowerCase() === 'workdrive');
			if (wdIdx >= 0) {
				const wdId = pathTokens[wdIdx + 1] || '';
				if (wdId && /^[a-z0-9]{12,}$/i.test(wdId)) {
					log.debug('WORKDRIVE extract id', { folderId: wdId, source: 'workdrive-path' });
					return wdId;
				}
			}
		} catch {
			// ignore malformed url
		}

		const rawId = trimmed.match(/^[a-z0-9]{12,}$/i);
		if (rawId) return trimmed;

		const folderPathMatch = trimmed.match(/\/folders?\/([a-z0-9]+)/i);
		if (folderPathMatch?.[1] && folderPathMatch[1].toLowerCase() !== 'files') {
			return folderPathMatch[1];
		}

		const resourceMatch = trimmed.match(/resource_id=([a-z0-9]+)/i);
		if (resourceMatch?.[1]) return resourceMatch[1];
		const folderIdMatch = trimmed.match(/folder_id=([a-z0-9]+)/i);
		if (folderIdMatch?.[1]) return folderIdMatch[1];
		const folderIdAltMatch = trimmed.match(/folderId=([a-z0-9]+)/i);
		if (folderIdAltMatch?.[1]) return folderIdAltMatch[1];

		try {
			const url = new URL(trimmed);
			const folderQuery =
				url.searchParams.get('folder_id') ||
				url.searchParams.get('folderId') ||
				url.searchParams.get('resource_id') ||
				url.searchParams.get('resourceId');
			if (folderQuery) return folderQuery;

			const pathTokens = url.pathname.split('/').filter(Boolean);
			for (let i = 0; i < pathTokens.length; i += 1) {
				const token = pathTokens[i]?.toLowerCase();
				const next = pathTokens[i + 1] || '';
				if (!next) continue;
				if (token === 'folder' || token === 'folders') return next;
			}
		} catch {
			// ignore malformed url
		}

		return '';
	};

	const walk = (node: unknown, depth = 0): string => {
		if (depth > 6 || node === null || node === undefined) return '';

		if (typeof node === 'string') {
			return extractFromString(node);
		}

		if (Array.isArray(node)) {
			for (const item of node) {
				const found = walk(item, depth + 1);
				if (found) return found;
			}
			return '';
		}

		if (typeof node !== 'object') return '';
		if (seen.has(node as object)) return '';
		seen.add(node as object);

		for (const [rawKey, rawValue] of Object.entries(node as Record<string, unknown>)) {
			const key = rawKey.toLowerCase();
			if (typeof rawValue === 'string') {
				const fromString = extractFromString(rawValue);
				if (fromString) return fromString;

				if (key.includes('folder') || key.includes('resource')) {
					const rawId = rawValue.trim();
					if (/^[a-z0-9]{12,}$/i.test(rawId)) return rawId;
				}
			}

			const nested = walk(rawValue, depth + 1);
			if (nested) return nested;
		}

		return '';
	};

	return walk(value, 0);
}

if (process.env.NODE_ENV !== 'production') {
	log.debug('WORKDRIVE manual test', {
		folderId: extractWorkDriveFolderId(
			'https://workdrive.zoho.com/folder/2zgyn6a8d7dfb94b64f9a8393b736056c7e62'
		)
	});
}

/**
 * If `value` is a Zoho WorkDrive external share URL
 * (https://workdrive.zohoexternal.com/external/{hash}),
 * returns the hash string. Otherwise returns null.
 */
export function extractExternalLinkHash(value: unknown): string | null {
	const str = typeof value === 'string' ? value.trim() : '';
	if (!str) return null;
	try {
		const url = new URL(str);
		if (/zohoexternal\.com/i.test(url.hostname)) {
			const pathTokens = url.pathname.split('/').filter(Boolean);
			const externalIdx = pathTokens.findIndex((t) => t.toLowerCase() === 'external');
			if (externalIdx >= 0 && pathTokens[externalIdx + 1]) {
				return pathTokens[externalIdx + 1];
			}
		}
	} catch {
		// ignore malformed URLs
	}
	return null;
}

/**
 * Calls the WorkDrive links API to resolve an external share link hash into
 * an internal resource_id (folder/file ID).
 *
 * The hash in `https://workdrive.zohoexternal.com/external/{hash}` is the
 * same value as the `link_id` used in `GET /workdrive/api/v1/links/{link_id}`.
 */
export async function resolveExternalLink(
	accessToken: string,
	linkHash: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	try {
		const url = `${base}/links/${encodeURIComponent(linkHash)}`;
		log.info('resolveExternalLink: calling', { url: url.slice(0, 120), linkHash: linkHash.slice(0, 20) });
		const response = await fetch(url, {
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			}
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			log.info('resolveExternalLink: API call failed', { linkHash: linkHash.slice(0, 20), status: response.status, body: body.slice(0, 300) });
			return null;
		}
		const data = await response.json().catch(() => null);
		const resourceId =
			data?.data?.attributes?.resource_id ||
			data?.data?.attributes?.resourceId ||
			data?.data?.id ||
			'';
		if (resourceId) {
			log.info('resolveExternalLink: resolved', { linkHash: linkHash.slice(0, 20), resourceId });
			return String(resourceId).trim();
		}
		log.info('resolveExternalLink: no resource_id in response', { linkHash: linkHash.slice(0, 20), keys: data ? Object.keys(data) : null });
		return null;
	} catch (err) {
		log.info('resolveExternalLink: error', { linkHash: linkHash.slice(0, 20), error: String(err) });
		return null;
	}
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

	// Priority 1: exact match
	for (const folder of folders) {
		const nf = normalizeName(folder.name || '');
		if (!nf) continue;
		for (const candidate of normalizedCandidates) {
			if (nf === candidate) return folder;
		}
	}

	// Priority 2: folder starts with candidate (folder "john smith kitchen" matches candidate "john smith")
	let best: WorkDriveItem | null = null;
	let bestScore = 0;
	for (const folder of folders) {
		const nf = normalizeName(folder.name || '');
		if (!nf) continue;
		for (const candidate of normalizedCandidates) {
			if (!candidate) continue;
			if (nf.startsWith(candidate) && candidate.length > bestScore) {
				bestScore = candidate.length;
				best = folder;
			}
		}
	}
	if (best) return best;

	// Priority 3: candidate starts with folder (candidate "john smith 12 29 2025" matches folder "john smith")
	for (const folder of folders) {
		const nf = normalizeName(folder.name || '');
		if (!nf || nf.length < 4) continue;
		for (const candidate of normalizedCandidates) {
			if (!candidate) continue;
			if (candidate.startsWith(nf) && nf.length > bestScore) {
				bestScore = nf.length;
				best = folder;
			}
		}
	}
	return best;
}

export function findPhotosFolder(items: WorkDriveItem[]) {
	const folders = items.filter((item) => item.type === 'folder');
	if (folders.length === 0) return null;
	const normalizedTargets = ['client portal', 'photos', 'photo', 'progress photos', 'progress photo'];

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

/**
 * Create a folder inside a WorkDrive parent folder. Returns the new folder id,
 * or null on failure.
 */
export async function createWorkDriveFolder(
	accessToken: string,
	parentId: string,
	name: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const res = await fetch(`${base}/files`, {
		method: 'POST',
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			Accept: 'application/vnd.api+json'
		},
		body: JSON.stringify({ data: { attributes: { name, parent_id: parentId }, type: 'files' } })
	});
	if (!res.ok) {
		console.warn('[workdrive] createFolder failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
		return null;
	}
	const payload = await res.json().catch(() => null);
	const id = payload?.data?.id ?? payload?.data?.attributes?.resource_id ?? null;
	return id ? String(id) : null;
}

/**
 * Upload file bytes into a WorkDrive folder via the multipart upload API.
 * Returns the new file's resource id, or null on failure.
 */
export async function uploadFileToWorkDriveFolder(
	accessToken: string,
	parentId: string,
	fileName: string,
	bytes: Uint8Array | ArrayBuffer,
	contentType: string,
	apiDomain?: string
): Promise<string | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const form = new FormData();
	form.append('parent_id', parentId);
	form.append('filename', fileName);
	const blob = new Blob([new Uint8Array(bytes)], { type: contentType || 'application/octet-stream' });
	form.append('content', blob, fileName);
	// NOTE: do not set Content-Type — fetch adds the multipart boundary.
	const res = await fetch(`${base}/upload`, {
		method: 'POST',
		headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
		body: form
	});
	if (!res.ok) {
		console.warn('[workdrive] upload failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
		return null;
	}
	const payload = await res.json().catch(() => null);
	const d = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
	const id = d?.attributes?.resource_id ?? d?.id ?? null;
	return id ? String(id) : null;
}

/**
 * Resolve the deal's "Client Portal/Photos" folder, creating "Photos" if it's
 * missing. Falls back to a "Photos" folder at the deal root when there's no
 * "Client Portal" subfolder. Returns the destination folder id, or null.
 */
export async function resolveOrCreateClientPhotosFolder(
	accessToken: string,
	rootFolderId: string,
	apiDomain?: string
): Promise<string | null> {
	const rootItems = await listWorkDriveFolder(accessToken, rootFolderId, apiDomain).catch(() => []);
	const clientPortal = findBestFolderByName(rootItems, ['Client Portal', 'Client Portal Folder']);
	const containerId = clientPortal?.id ?? rootFolderId;
	const containerItems = clientPortal
		? await listWorkDriveFolder(accessToken, containerId, apiDomain).catch(() => [])
		: rootItems;
	const photos = findBestFolderByName(containerItems, ['Photos', 'Photo', 'Progress Photos']);
	if (photos?.id) return photos.id;
	return createWorkDriveFolder(accessToken, containerId, 'Photos', apiDomain);
}

/**
 * Download a WorkDrive file's binary content by file id.
 * Tries the documented download host first, then falls back to the older
 * /api/v1/download path. Returns a Buffer on success.
 */
export async function downloadWorkDriveFile(
	accessToken: string,
	fileId: string,
	apiDomain?: string
): Promise<Buffer> {
	const candidates = Array.from(getWorkDriveDownloadCandidates(apiDomain));
	let lastError = '';
	for (const base of candidates) {
		const url = `${base.replace(/\/$/, '')}/${encodeURIComponent(fileId)}`;
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
			});
			if (response.status === 200) {
				const ab = await response.arrayBuffer();
				return Buffer.from(ab);
			}
			lastError = `${url} -> HTTP ${response.status}`;
		} catch (err) {
			lastError = `${url} -> ${err instanceof Error ? err.message : 'fetch failed'}`;
		}
	}
	throw new Error(`WorkDrive download failed for ${fileId}: ${lastError}`);
}

/**
 * Download a Zoho-native Sheet exported as a portable format (default `xlsx`).
 * Native sheets don't return parseable bytes from the regular download
 * endpoint, so we ask Zoho's `/files/{id}/permalink?format=xlsx` shim — and if
 * that 404s on a particular org, fall back to `?format=xlsx` on the standard
 * download URL, which the older API exposes.
 */
export async function downloadZohoSheetAsXlsx(
	accessToken: string,
	fileId: string,
	apiDomain?: string
): Promise<Buffer> {
	const base = getWorkDriveApiBase(apiDomain).replace(/\/$/, '');
	const exportUrl = `${base}/files/${encodeURIComponent(fileId)}/permalink?format=xlsx&download=true`;
	const headers = {
		Authorization: `Zoho-oauthtoken ${accessToken}`,
		Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	};
	let lastError = '';
	try {
		const response = await fetch(exportUrl, { method: 'GET', headers });
		if (response.status === 200) {
			const ab = await response.arrayBuffer();
			return Buffer.from(ab);
		}
		lastError = `${exportUrl} -> HTTP ${response.status}`;
	} catch (err) {
		lastError = `${exportUrl} -> ${err instanceof Error ? err.message : 'fetch failed'}`;
	}
	// Fallback: the older download host accepts ?format=xlsx
	for (const downloadBase of Array.from(getWorkDriveDownloadCandidates(apiDomain))) {
		const url = `${downloadBase.replace(/\/$/, '')}/${encodeURIComponent(fileId)}?format=xlsx`;
		try {
			const response = await fetch(url, { method: 'GET', headers });
			if (response.status === 200) {
				const ab = await response.arrayBuffer();
				return Buffer.from(ab);
			}
			lastError = `${url} -> HTTP ${response.status}`;
		} catch (err) {
			lastError = `${url} -> ${err instanceof Error ? err.message : 'fetch failed'}`;
		}
	}
	throw new Error(`Zoho Sheet export failed for ${fileId}: ${lastError}`);
}

/**
 * Download a Zoho-native Writer document exported as DOCX. Same pattern as
 * downloadZohoSheetAsXlsx — native Writer files don't return parseable bytes
 * from the normal download endpoint, so we hit `/files/{id}/permalink?format=docx`
 * and fall back to the older download host with `?format=docx`.
 */
export async function downloadZohoWriterAsDocx(
	accessToken: string,
	fileId: string,
	apiDomain?: string
): Promise<Buffer> {
	const base = getWorkDriveApiBase(apiDomain).replace(/\/$/, '');
	const exportUrl = `${base}/files/${encodeURIComponent(fileId)}/permalink?format=docx&download=true`;
	const headers = {
		Authorization: `Zoho-oauthtoken ${accessToken}`,
		Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	};
	let lastError = '';
	try {
		const response = await fetch(exportUrl, { method: 'GET', headers });
		if (response.status === 200) {
			const ab = await response.arrayBuffer();
			return Buffer.from(ab);
		}
		lastError = `${exportUrl} -> HTTP ${response.status}`;
	} catch (err) {
		lastError = `${exportUrl} -> ${err instanceof Error ? err.message : 'fetch failed'}`;
	}
	for (const downloadBase of Array.from(getWorkDriveDownloadCandidates(apiDomain))) {
		const url = `${downloadBase.replace(/\/$/, '')}/${encodeURIComponent(fileId)}?format=docx`;
		try {
			const response = await fetch(url, { method: 'GET', headers });
			if (response.status === 200) {
				const ab = await response.arrayBuffer();
				return Buffer.from(ab);
			}
			lastError = `${url} -> HTTP ${response.status}`;
		} catch (err) {
			lastError = `${url} -> ${err instanceof Error ? err.message : 'fetch failed'}`;
		}
	}
	throw new Error(`Zoho Writer export failed for ${fileId}: ${lastError}`);
}
