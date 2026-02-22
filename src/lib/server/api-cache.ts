import { supabase } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';

const log = createLogger('api-cache');
const CACHE_TABLE = 'api_response_cache';

type CacheResult = { data: any; isStale: boolean };

type CacheOptions = {
	staleSec?: number;
	expireSec?: number;
};

export function buildCacheKey(...parts: string[]): string {
	return parts.filter(Boolean).join(':');
}

export async function getCache(cacheKey: string): Promise<CacheResult | null> {
	if (!cacheKey) return null;
	try {
		const { data, error } = await supabase
			.from(CACHE_TABLE)
			.select('response_json, stale_at, expires_at')
			.eq('cache_key', cacheKey)
			.maybeSingle();

		if (error) {
			log.warn('API cache read failed', { cacheKey, error: error.message });
			return null;
		}
		if (!data) return null;

		const staleAtMs = data.stale_at ? new Date(data.stale_at).getTime() : 0;
		const isStale = !staleAtMs || staleAtMs < Date.now();
		return { data: data.response_json, isStale };
	} catch (err) {
		log.warn('API cache read failed', {
			cacheKey,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

export async function setCache(
	cacheKey: string,
	data: any,
	options: CacheOptions = {}
): Promise<void> {
	if (!cacheKey) return;
	const staleSec = options.staleSec ?? 120;
	const expireSec = Math.max(options.expireSec ?? 0, 60 * 60 * 24 * 365);
	const now = new Date();
	const staleAt = new Date(now.getTime() + staleSec * 1000).toISOString();
	const expiresAt = new Date(now.getTime() + expireSec * 1000).toISOString();
	try {
		const { error } = await supabase.from(CACHE_TABLE).upsert(
			{
				cache_key: cacheKey,
				response_json: data,
				updated_at: now.toISOString(),
				stale_at: staleAt,
				expires_at: expiresAt
			},
			{ onConflict: 'cache_key' }
		);

		if (error) {
			log.warn('API cache write failed', { cacheKey, error: error.message });
			return;
		}

		log.debug('API cache updated', { cacheKey, staleAt, expiresAt });
	} catch (err) {
		log.warn('API cache write failed', {
			cacheKey,
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

export async function clearCache(pattern?: string): Promise<void> {
	try {
		const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const query = supabase.from(CACHE_TABLE).delete();
		const { error } = pattern
			? await query.like('cache_key', pattern)
			: await query.lt('updated_at', cutoff);
		if (error) {
			log.warn('API cache clear failed', {
				pattern: pattern ?? null,
				error: error.message
			});
		}
	} catch (err) {
		log.warn('API cache clear failed', {
			pattern: pattern ?? null,
			error: err instanceof Error ? err.message : String(err)
		});
	}
}
