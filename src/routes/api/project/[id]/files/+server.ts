import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getCachedFolder, setCachedFolder } from '$lib/server/folder-cache';
import { createLogger } from '$lib/server/logger';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	extractExternalLinkHash,
	extractWorkDriveFolderId,
	listWorkDriveFolder,
	resolveExternalLink
} from '$lib/server/workdrive';
import { getOrCreateWorkDriveFileShare } from '$lib/server/workdrive-shares';
import type { RequestHandler } from './$types';

const log = createLogger('client-portal-files');

// Listing the Client Portal folder fans out one WorkDrive call per subfolder;
// cap it so a misconfigured folder can't stall the dashboard.
const MAX_SUBFOLDERS = 10;

interface FileEntry {
	id: string;
	name: string;
	folder: string | null;
	mime: string | null;
	modifiedTime: string | null;
	url: string | null;
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho tokens not configured');

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain || undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope
		});
	}
	return { accessToken, apiDomain };
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

async function enrichFiles(
	accessToken: string,
	items: Awaited<ReturnType<typeof listWorkDriveFolder>>,
	folder: string | null,
	apiDomain?: string
): Promise<FileEntry[]> {
	const files = items.filter((it) => it.type === 'file');
	return Promise.all(
		files.map(async (it) => {
			// External per-file share so clients aren't stopped at a Zoho login
			// wall. Created once and cached in Supabase by workdrive-shares.
			const url = it.id
				? await getOrCreateWorkDriveFileShare({
						accessToken,
						apiDomain,
						fileId: it.id,
						fileName: it.name
					}).catch(() => null)
				: null;
			return {
				id: it.id,
				name: it.name,
				folder,
				mime: it.mime ?? null,
				modifiedTime: it.modifiedTime ?? null,
				url
			} satisfies FileEntry;
		})
	);
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session?.client) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '').trim() === dealId)) {
		throw error(403, 'Access denied to this project');
	}

	const { accessToken, apiDomain } = await getAccessToken();

	// ── Resolve the Client Portal folder ID ────────────────────────────
	let folderId = '';
	try {
		const cached = await getCachedFolder(dealId, 'client-portal');
		if (cached?.folderId) folderId = cached.folderId;
	} catch {
		/* cache miss is fine */
	}

	if (!folderId) {
		const dealFields = 'Deal_Name,Client_Portal_Folder,External_Link,WorkDrive_Folder_ID';
		const dealResponse = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent(dealFields)}`,
			{},
			apiDomain
		);
		const deal = dealResponse?.data?.[0] ?? {};

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
			const rawRoot = typeof deal?.WorkDrive_Folder_ID === 'string' ? deal.WorkDrive_Folder_ID.trim() : '';
			const rootId = extractWorkDriveFolderId(rawRoot) || rawRoot;
			if (rootId) {
				const rootItems = await listWorkDriveFolder(accessToken, rootId, apiDomain).catch(() => []);
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
	}

	if (!folderId) {
		return json({ files: [], message: 'Client portal folder not found for this project' });
	}

	// ── List the folder: top-level files plus one level of subfolders ──
	let items: Awaited<ReturnType<typeof listWorkDriveFolder>> = [];
	try {
		items = await listWorkDriveFolder(accessToken, folderId, apiDomain);
	} catch (err) {
		log.warn('Client portal folder listing failed', {
			dealId,
			folderId,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ files: [], message: 'Unable to list documents right now' });
	}

	const files: FileEntry[] = await enrichFiles(accessToken, items, null, apiDomain);

	const subfolders = items.filter((it) => it.type === 'folder').slice(0, MAX_SUBFOLDERS);
	for (const sub of subfolders) {
		const subItems = await listWorkDriveFolder(accessToken, sub.id, apiDomain).catch(() => []);
		files.push(...(await enrichFiles(accessToken, subItems, sub.name, apiDomain)));
	}

	files.sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name));

	return json({ files });
};
