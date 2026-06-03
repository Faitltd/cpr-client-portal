import { json, error } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { listWorkDriveFolder, extractWorkDriveFolderId } from '$lib/server/workdrive';
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
}

async function listFilesInFolder(
	accessToken: string,
	folderId: string,
	apiDomain?: string
): Promise<FileEntry[]> {
	const items = await listWorkDriveFolder(accessToken, folderId, apiDomain);
	return items
		.filter((it) => it.type === 'file')
		.map((it) => ({
			id: it.id,
			name: it.name,
			mime: it.mime ?? null,
			modifiedTime: it.modifiedTime ?? null
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
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

	// Read Deal's WorkDrive root folder id + admin-pasted internal URL.
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=WorkDrive_Folder_ID,WorkDrive_Internal_URL,External_Link,Client_Portal_Folder`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const directId =
		typeof rec.WorkDrive_Folder_ID === 'string' ? rec.WorkDrive_Folder_ID.trim() : '';
	const internalProjectUrl =
		typeof rec.WorkDrive_Internal_URL === 'string' ? rec.WorkDrive_Internal_URL.trim() : '';
	let projectFolderId =
		directId ||
		extractWorkDriveFolderId(typeof rec.External_Link === 'string' ? rec.External_Link : '') ||
		extractWorkDriveFolderId(
			typeof rec.Client_Portal_Folder === 'string' ? rec.Client_Portal_Folder : ''
		) ||
		extractWorkDriveFolderId(internalProjectUrl) ||
		null;

	if (!projectFolderId) {
		return json({
			designs: [],
			sow: [],
			projectFolderUrl: internalProjectUrl || null,
			message: 'No WorkDrive folder linked to this Deal'
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
		// Internal URLs — open the folder inside the WorkDrive app (requires
		// the user to be signed in to Zoho). Used instead of the external
		// client-portal share for staff and trade-partner views.
		projectFolderUrl: internalProjectUrl || buildInternalFolderUrl(projectFolderId),
		designsFolderUrl: designsFolder ? buildInternalFolderUrl(designsFolder.id) : null,
		sowFolderUrl: sowFolder ? buildInternalFolderUrl(sowFolder.id) : null
	});
};
