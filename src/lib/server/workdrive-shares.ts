import { supabase } from '$lib/server/db';
import { getWorkDriveApiBase } from '$lib/server/workdrive';

/**
 * External (no-Zoho-login) share URL for a single WorkDrive file.
 *
 * Trade partners don't have Zoho accounts, so internal /file/{id} URLs are
 * useless to them. We mint per-file `/links` external shares via the
 * WorkDrive API and cache the result in Supabase so we only create each
 * share once.
 *
 * The body shape that works for CPR's org (matches what
 * CPR_Create_Project_And_WorkDrive uses for SOW / Designs / Change Orders):
 *   { resource_id, link_name, request_user_data:false, allow_download:true, role_id:"6" }
 *
 * role_id "6" = viewer (download allowed, no edits, no Zoho login required).
 */

interface CachedShare {
	file_id: string;
	external_url: string;
	link_id: string | null;
}

async function readCachedShare(fileId: string): Promise<CachedShare | null> {
	const { data, error } = await supabase
		.from('workdrive_file_shares')
		.select('file_id, external_url, link_id')
		.eq('file_id', fileId)
		.maybeSingle();
	if (error) {
		console.warn('[workdrive-shares] cache read failed:', error.message);
		return null;
	}
	if (data) {
		await supabase
			.from('workdrive_file_shares')
			.update({ last_used_at: new Date().toISOString() })
			.eq('file_id', fileId);
	}
	return (data as CachedShare | null) ?? null;
}

async function writeCachedShare(
	fileId: string,
	externalUrl: string,
	linkId: string | null
): Promise<void> {
	const { error } = await supabase.from('workdrive_file_shares').upsert(
		{
			file_id: fileId,
			external_url: externalUrl,
			link_id: linkId,
			last_used_at: new Date().toISOString()
		},
		{ onConflict: 'file_id' }
	);
	if (error) console.warn('[workdrive-shares] cache write failed:', error.message);
}

interface CreateShareResult {
	externalUrl: string;
	linkId: string | null;
}

async function createWorkDriveFileShare(
	accessToken: string,
	apiDomain: string | undefined,
	fileId: string,
	fileName: string
): Promise<CreateShareResult | null> {
	const base = getWorkDriveApiBase(apiDomain);
	const url = `${base}/links`;
	// Flat body shape — same as CPR_Create_Project_And_WorkDrive Deluge fn.
	// role_id "6" = viewer-with-download, no Zoho login required.
	const body = {
		resource_id: fileId,
		link_name: `${fileName.slice(0, 80)} Share`,
		request_user_data: false,
		allow_download: true,
		role_id: '6'
	};
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			Accept: 'application/vnd.api+json',
			'Content-Type': 'application/vnd.api+json'
		},
		body: JSON.stringify(body)
	});
	if (!response.ok) {
		const errBody = await response.text().catch(() => '');
		console.warn(
			`[workdrive-shares] create failed for ${fileId} (${response.status}):`,
			errBody.slice(0, 300)
		);
		return null;
	}
	const json = await response.json().catch(() => null);
	// Response shape may be flat or wrapped — try both.
	const data = json?.data ?? json ?? {};
	const attrs = data?.attributes ?? data ?? {};
	const linkId = data?.id ?? attrs?.id ?? json?.link_id ?? null;
	const externalUrl =
		attrs.link_url ??
		attrs.shared_link ??
		attrs.short_url ??
		attrs.permalink ??
		json?.link_url ??
		json?.permalink ??
		null;
	if (!externalUrl) {
		console.warn('[workdrive-shares] create returned no URL', JSON.stringify(json).slice(0, 300));
		return null;
	}
	return { externalUrl: String(externalUrl), linkId: linkId ? String(linkId) : null };
}

/**
 * Get an external (no-login) share URL for a file. Reuses cached shares;
 * mints a new one on first request. Returns null if the API rejects the
 * share creation (caller should fall back to the internal /file/{id} URL or
 * omit the link).
 */
export async function getOrCreateWorkDriveFileShare(opts: {
	accessToken: string;
	apiDomain?: string;
	fileId: string;
	fileName: string;
}): Promise<string | null> {
	const cached = await readCachedShare(opts.fileId);
	if (cached?.external_url) {
		console.log(`[workdrive-shares] cache hit ${opts.fileId}`);
		return cached.external_url;
	}

	console.log(`[workdrive-shares] minting share for ${opts.fileId} (${opts.fileName})`);
	const created = await createWorkDriveFileShare(
		opts.accessToken,
		opts.apiDomain,
		opts.fileId,
		opts.fileName
	);
	if (!created) {
		console.warn(`[workdrive-shares] mint failed for ${opts.fileId}`);
		return null;
	}
	console.log(`[workdrive-shares] minted ${opts.fileId} → ${created.externalUrl}`);
	await writeCachedShare(opts.fileId, created.externalUrl, created.linkId);
	return created.externalUrl;
}
