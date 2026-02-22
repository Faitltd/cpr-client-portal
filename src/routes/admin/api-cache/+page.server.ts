import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import { clearCache } from '$lib/server/api-cache';
import type { Actions, PageServerLoad } from './$types';

type CacheRow = {
	id: string;
	cache_key: string;
	response_json: unknown;
	updated_at: string | null;
	stale_at: string | null;
	expires_at: string | null;
};

type CacheEntry = {
	id: string;
	cache_key: string;
	updated_at: string | null;
	stale_at: string | null;
	status: 'fresh' | 'stale';
	dataSize: number;
};

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const { data, error } = await supabase
		.from('api_response_cache')
		.select('id, cache_key, response_json, updated_at, stale_at, expires_at')
		.order('updated_at', { ascending: false });

	if (error) {
		throw new Error(`Failed to load API cache: ${error.message}`);
	}

	const rows = (data || []) as CacheRow[];
	const now = Date.now();
	const entries: CacheEntry[] = rows.map((row) => {
		const staleAtMs = row.stale_at ? new Date(row.stale_at).getTime() : 0;
		const status = staleAtMs && staleAtMs > now ? 'fresh' : 'stale';
		let dataSize = 0;
		try {
			dataSize = Math.round((JSON.stringify(row.response_json).length / 1024) * 10) / 10;
		} catch {
			dataSize = 0;
		}

		return {
			id: row.id,
			cache_key: row.cache_key,
			updated_at: row.updated_at,
			stale_at: row.stale_at,
			status,
			dataSize
		};
	});

	const staleCount = entries.filter((entry) => entry.status === 'stale').length;
	const freshCount = entries.length - staleCount;

	return {
		entries,
		totalCount: entries.length,
		staleCount,
		freshCount
	};
};

export const actions: Actions = {
	clearOne: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const cacheKey = String(form.get('cacheKey') || '').trim();
		if (cacheKey) {
			const { error } = await supabase
				.from('api_response_cache')
				.delete()
				.eq('cache_key', cacheKey);
			if (error) {
				throw new Error(`Failed to clear API cache entry: ${error.message}`);
			}
		}
		throw redirect(303, '/admin/api-cache');
	},
	clearPattern: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const pattern = String(form.get('pattern') || '').trim();
		if (pattern) {
			await clearCache(pattern);
		}
		throw redirect(303, '/admin/api-cache');
	},
	clearStale: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const cutoff = new Date().toISOString();
		const { error } = await supabase
			.from('api_response_cache')
			.delete()
			.lt('stale_at', cutoff);
		if (error) {
			throw new Error(`Failed to clear stale API cache entries: ${error.message}`);
		}
		throw redirect(303, '/admin/api-cache');
	},
	clearAll: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const { error } = await supabase.from('api_response_cache').delete().not('id', 'is', null);
		if (error) {
			throw new Error(`Failed to clear API cache: ${error.message}`);
		}
		throw redirect(303, '/admin/api-cache');
	}
};
