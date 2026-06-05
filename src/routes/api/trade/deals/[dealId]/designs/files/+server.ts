import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { listWorkDriveFolder, extractWorkDriveFolderId } from '$lib/server/workdrive';
import { getOrCreateWorkDriveFileShare } from '$lib/server/workdrive-shares';
import type { RequestHandler } from './$types';

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

function normalizeName(s: string) {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const DESIGN_FOLDER_NAMES = new Set(
	['designs', 'design', 'design and planning', 'design & planning', 'designs and planning'].map(
		normalizeName
	)
);

const SOW_FOLDER_NAMES = new Set(
	['sow', 'scope of work', 'scopes', 'scope', 'scope of works'].map(normalizeName)
);

interface FileEntry {
	id: string;
	name: string;
	mime: string | null;
	modifiedTime: string | null;
	url: string | null;
}

async function listFilesInFolder(
	accessToken: string,
	folderId: string,
	apiDomain?: string
): Promise<FileEntry[]> {
	const items = await listWorkDriveFolder(accessToken, folderId, apiDomain);
	const files = items.filter((it) => it.type === 'file');
	// Mint / look up an external (no-Zoho-login) share URL per file. Trade
	// partners don't have Zoho accounts; the internal /file/{id} URL would
	// dump them at the login wall. Each share is created once and cached in
	// Supabase, so subsequent calls are a single SELECT.
	const enriched = await Promise.all(
		files.map(async (it) => {
			let externalUrl: string | null = null;
			if (it.id) {
				externalUrl = await getOrCreateWorkDriveFileShare({
					accessToken,
					apiDomain,
					fileId: it.id,
					fileName: it.name
				}).catch(() => null);
			}
			return {
				id: it.id,
				name: it.name,
				mime: it.mime ?? null,
				modifiedTime: it.modifiedTime ?? null,
				url: externalUrl
			} satisfies FileEntry;
		})
	);
	return enriched.sort((a, b) => a.name.localeCompare(b.name));
}

async function findSubfolder(
	accessToken: string,
	parentId: string,
	names: Set<string>,
	apiDomain?: string
): Promise<{ id: string; name: string } | null> {
	const items = await listWorkDriveFolder(accessToken, parentId, apiDomain);
	for (const item of items) {
		if (item.type !== 'folder') continue;
		if (names.has(normalizeName(item.name))) return { id: item.id, name: item.name };
	}
	return null;
}

/**
 * Internal WorkDrive folder URL — opens the folder in the Zoho WorkDrive app
 * when the user is signed in to Zoho. This is what CPR staff and trade
 * partners want as the "Open folder" link, NOT the client-portal external
 * share (which is meant for clients/homeowners).
 *
 * Format mirrors the canonical Zoho-app URL: /home/teams/{team}/ws/{ws}/folders/{id}
 * is the long form, but the short form /folder/{id} reliably resolves once
 * the user is authenticated. We prefer WorkDrive_Internal_URL from the Deal
 * record if it's populated (admin-pasted), and synthesise the short form as
 * a fallback.
 */
function buildInternalFolderUrl(folderId: string): string {
	return `https://workdrive.zoho.com/folder/${encodeURIComponent(folderId)}`;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');
	const session = await getTradeSession(sessionToken);
	if (!session || new Date(session.expires_at) < new Date()) throw error(401, 'Session expired');

	const dealId = params.dealId;
	if (!dealId) throw error(400, 'Missing dealId');

	const { accessToken, apiDomain } = await getAccessToken();

	// SOURCE OF TRUTH: WorkDrive_Folder_ID on the Deal. We don't fall back to
	// External_Link or Client_Portal_Folder anymore — those hold the CLIENT
	// portal share, which is the wrong destination for staff/trade partners.
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=WorkDrive_Folder_ID`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const rawId = typeof rec.WorkDrive_Folder_ID === 'string' ? rec.WorkDrive_Folder_ID.trim() : '';
	// Accept either a bare folder id or a pasted URL like
	// https://workdrive.zoho.com/folder/<id> — extractWorkDriveFolderId returns
	// the id from a URL, or null for a bare id, so we fall through to rawId.
	const projectFolderId = extractWorkDriveFolderId(rawId) || rawId || null;

	if (!projectFolderId) {
		return json({
			designs: [],
			sow: [],
			projectFolderUrl: null,
			message: 'WorkDrive_Folder_ID is empty on this Deal'
		});
	}

	const designsFolder = await findSubfolder(
		accessToken,
		projectFolderId,
		DESIGN_FOLDER_NAMES,
		apiDomain
	).catch(() => null);

	// SOW is typically nested under Designs (per CPR's WorkDrive layout); fall
	// back to the project root if it's not where we expected.
	let sowFolder: { id: string; name: string } | null = null;
	if (designsFolder) {
		sowFolder = await findSubfolder(
			accessToken,
			designsFolder.id,
			SOW_FOLDER_NAMES,
			apiDomain
		).catch(() => null);
	}
	if (!sowFolder) {
		sowFolder = await findSubfolder(
			accessToken,
			projectFolderId,
			SOW_FOLDER_NAMES,
			apiDomain
		).catch(() => null);
	}

	const designsFiles = designsFolder
		? await listFilesInFolder(accessToken, designsFolder.id, apiDomain).catch(() => [])
		: [];
	const sowFiles = sowFolder
		? await listFilesInFolder(accessToken, sowFolder.id, apiDomain).catch(() => [])
		: [];

	return json({
		designs: designsFiles,
		sow: sowFiles,
		designsFolderName: designsFolder?.name ?? null,
		sowFolderName: sowFolder?.name ?? null,
		// Internal WorkDrive URLs built from WorkDrive_Folder_ID. Requires the
		// user to be signed in to Zoho — staff/trade-partner destination.
		projectFolderUrl: buildInternalFolderUrl(projectFolderId),
		designsFolderUrl: designsFolder ? buildInternalFolderUrl(designsFolder.id) : null,
		sowFolderUrl: sowFolder ? buildInternalFolderUrl(sowFolder.id) : null
	});
};
