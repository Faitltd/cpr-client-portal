import { supabase } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';

const log = createLogger('folder-cache');
const CACHE_TABLE = 'workdrive_folder_cache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedFolder = { folderId: string; folderName: string | null };

export async function getCachedFolder(
	dealId: string,
	folderType: string
): Promise<CachedFolder | null> {
	if (!dealId || !folderType) return null;
	const now = new Date().toISOString();
	const { data, error } = await supabase
		.from(CACHE_TABLE)
		.select('folder_id, folder_name, expires_at')
		.eq('deal_id', dealId)
		.eq('folder_type', folderType)
		.gt('expires_at', now)
		.maybeSingle();

	if (error) {
		log.warn('Failed to read WorkDrive folder cache', {
			dealId,
			folderType,
			error: error.message
		});
		return null;
	}
	if (!data) return null;
	return { folderId: data.folder_id, folderName: data.folder_name ?? null };
}

export async function setCachedFolder(
	dealId: string,
	folderType: string,
	folderId: string,
	folderName?: string
): Promise<void> {
	if (!dealId || !folderType || !folderId) return;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
	const { error } = await supabase.from(CACHE_TABLE).upsert(
		{
			deal_id: dealId,
			folder_type: folderType,
			folder_id: folderId,
			folder_name: folderName ?? null,
			resolved_at: now.toISOString(),
			expires_at: expiresAt
		},
		{ onConflict: 'deal_id,folder_type' }
	);

	if (error) {
		log.error('Failed to write WorkDrive folder cache', {
			dealId,
			folderType,
			folderId,
			error: error.message
		});
	}
}

export async function clearFolderCache(dealId?: string): Promise<void> {
	const now = new Date().toISOString();
	const query = supabase.from(CACHE_TABLE).delete();
	const { error } = dealId
		? await query.eq('deal_id', dealId)
		: await query.lt('expires_at', now);

	if (error) {
		log.warn('Failed to clear WorkDrive folder cache', {
			dealId: dealId ?? null,
			error: error.message
		});
	}
}
