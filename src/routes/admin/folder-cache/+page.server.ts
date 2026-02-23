import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import { clearFolderCache } from '$lib/server/folder-cache';
import type { Actions, PageServerLoad } from './$types';

type CacheRow = {
	id: string;
	deal_id: string;
	folder_type: string;
	folder_id: string;
	folder_name: string | null;
	resolved_at: string | null;
	expires_at: string | null;
};

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const { data, error } = await supabase
		.from('workdrive_folder_cache')
		.select('id, deal_id, folder_type, folder_id, folder_name, resolved_at, expires_at')
		.order('resolved_at', { ascending: false });

	if (error) {
		throw new Error(`Failed to load folder cache: ${error.message}`);
	}

	const rows = (data || []) as CacheRow[];
	const now = Date.now();
	const expiredCount = rows.filter((row) => {
		if (!row.expires_at) return false;
		const expiresAt = new Date(row.expires_at).getTime();
		return Number.isFinite(expiresAt) && expiresAt < now;
	}).length;

	return {
		entries: rows,
		totalCount: rows.length,
		expiredCount,
		now
	};
};

export const actions: Actions = {
	clearExpired: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		await clearFolderCache();
		throw redirect(303, '/admin/folder-cache');
	},
	clearDeal: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const dealId = String(form.get('dealId') || '').trim();
		if (dealId) {
			await clearFolderCache(dealId);
		}
		throw redirect(303, '/admin/folder-cache');
	},
	clearAll: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const { error } = await supabase
			.from('workdrive_folder_cache')
			.delete()
			.not('id', 'is', null);
		if (error) {
			throw new Error(`Failed to clear folder cache: ${error.message}`);
		}
		throw redirect(303, '/admin/folder-cache');
	}
};
