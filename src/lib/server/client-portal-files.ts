import { getCachedFolder, setCachedFolder } from '$lib/server/folder-cache';
import { createLogger } from '$lib/server/logger';
import { zohoApiCall } from '$lib/server/zoho';
import {
	extractExternalLinkHash,
	extractWorkDriveFolderId,
	listWorkDriveFolder,
	resolveExternalLink,
	type WorkDriveItem
} from '$lib/server/workdrive';

const log = createLogger('client-portal-files');

// Listing the Client Portal folder fans out one WorkDrive call per subfolder;
// cap it so a misconfigured folder can't stall the dashboard.
const MAX_SUBFOLDERS = 10;

export interface ClientPortalFile {
	id: string;
	name: string;
	folder: string | null;
	mime: string | null;
	modifiedTime: string | null;
}

function normalizeName(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function resolveFolderIdFromField(
	accessToken: string,
	field: unknown,
	apiDomain?: string
): Promise<string | null> {
	if (typeof field !== 'string' || !field.trim()) return null;
	const raw = field.trim();
	const direct = extractWorkDriveFolderId(raw);
	if (direct) return direct;
	const hash = extractExternalLinkHash(raw);
	if (hash) {
		const resolved = await resolveExternalLink(accessToken, hash, apiDomain).catch(() => null);
		if (resolved) return resolved;
	}
	return null;
}

/**
 * Resolve the WorkDrive Client Portal folder ID for a deal. Cached in
 * folder_cache (type 'client-portal'); falls back to the CRM share-link
 * fields, then to a "Client Portal" subfolder under the project root.
 */
export async function resolveClientPortalFolderId(
	accessToken: string,
	dealId: string,
	apiDomain?: string
): Promise<string | null> {
	try {
		const cached = await getCachedFolder(dealId, 'client-portal');
		if (cached?.folderId) return cached.folderId;
	} catch {
		/* cache miss is fine */
	}

	const dealFields = 'Deal_Name,Client_Portal_Folder,External_Link,WorkDrive_Folder_ID';
	const dealResponse = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent(dealFields)}`,
		{},
		apiDomain
	);
	const deal = dealResponse?.data?.[0] ?? {};

	let folderId = '';

	// Priority 1/2: the client-portal share link, then the generic external link
	for (const field of [deal?.Client_Portal_Folder, deal?.External_Link]) {
		const resolved = await resolveFolderIdFromField(accessToken, field, apiDomain);
		if (resolved) {
			folderId = resolved;
			break;
		}
	}

	// Priority 3: project root folder → "Client Portal" subfolder
	if (!folderId) {
		const rawRoot =
			typeof deal?.WorkDrive_Folder_ID === 'string' ? deal.WorkDrive_Folder_ID.trim() : '';
		const rootId = extractWorkDriveFolderId(rawRoot) || rawRoot;
		if (rootId) {
			const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain).catch(
				() => [] as WorkDriveItem[]
			);
			const match = rootItems.find(
				(it) => it.type === 'folder' && normalizeName(it.name) === 'client portal'
			);
			if (match) folderId = match.id;
		}
	}

	if (folderId) {
		try {
			await setCachedFolder(dealId, 'client-portal', folderId);
		} catch {
			/* non-fatal */
		}
	}

	return folderId || null;
}

/**
 * List the files in a deal's Client Portal folder: top-level files plus one
 * level of subfolders.
 */
export async function listClientPortalFiles(
	accessToken: string,
	dealId: string,
	apiDomain?: string
): Promise<{ files: ClientPortalFile[]; folderId: string | null }> {
	const folderId = await resolveClientPortalFolderId(accessToken, dealId, apiDomain);
	if (!folderId) return { files: [], folderId: null };

	let items: WorkDriveItem[] = [];
	try {
		items = await listWorkDriveFolder(accessToken, folderId, apiDomain);
	} catch (err) {
		log.warn('Client portal folder listing failed', {
			dealId,
			folderId,
			error: err instanceof Error ? err.message : String(err)
		});
		return { files: [], folderId };
	}

	const toFile = (it: WorkDriveItem, folder: string | null): ClientPortalFile => ({
		id: it.id,
		name: it.name,
		folder,
		mime: it.mime ?? null,
		modifiedTime: it.modifiedTime ?? null
	});

	const files: ClientPortalFile[] = items
		.filter((it) => it.type === 'file')
		.map((it) => toFile(it, null));

	const subfolders = items.filter((it) => it.type === 'folder').slice(0, MAX_SUBFOLDERS);
	for (const sub of subfolders) {
		const subItems = await listWorkDriveFolder(accessToken, sub.id, apiDomain).catch(
			() => [] as WorkDriveItem[]
		);
		files.push(...subItems.filter((it) => it.type === 'file').map((it) => toFile(it, sub.name)));
	}

	files.sort(
		(a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name)
	);

	return { files, folderId };
}
