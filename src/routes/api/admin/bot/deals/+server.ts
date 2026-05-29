import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

interface DealItem {
	id: string;
	deal_name: string;
	stage: string;
	contact_name: string;
}

const EXCLUDE_STAGES = (env.BOT_SYNC_EXCLUDE_STAGES ?? 'Lost,On Hold,Completed')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

const COQL_PAGE_SIZE = 200; // Zoho COQL max
const COQL_MAX_PAGES = 10; // hard cap so we never loop forever
const CACHE_TTL_MS = 60_000; // 60s — admin-only dropdown, freshness within a minute is fine

interface CachedDeals {
	data: DealItem[];
	expiresAt: number;
}
let cache: CachedDeals | null = null;

function escapeCoqlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function extractContactName(contact: unknown): string {
	if (!contact) return '';
	if (typeof contact === 'string') return contact;
	if (typeof contact === 'object' && contact !== null && 'name' in contact) {
		return String((contact as { name: unknown }).name);
	}
	return '';
}

async function ensureAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
}

async function fetchDealsViaCoql(accessToken: string, apiDomain?: string): Promise<DealItem[]> {
	const excludeList = EXCLUDE_STAGES.map((s) => `'${escapeCoqlString(s)}'`).join(', ');
	const whereClause = excludeList ? `WHERE Stage NOT IN (${excludeList})` : '';

	const out: DealItem[] = [];
	const seen = new Set<string>();

	for (let page = 0; page < COQL_MAX_PAGES; page += 1) {
		const offset = page * COQL_PAGE_SIZE;
		const selectQuery = `SELECT id, Deal_Name, Stage, Contact_Name FROM Deals ${whereClause} ORDER BY Modified_Time DESC LIMIT ${COQL_PAGE_SIZE} OFFSET ${offset}`;

		const response = await zohoApiCall(
			accessToken,
			'/coql',
			{
				method: 'POST',
				body: JSON.stringify({ select_query: selectQuery })
			},
			apiDomain
		);

		const batch: any[] = Array.isArray(response?.data) ? response.data : [];
		if (batch.length === 0) break;

		for (const d of batch) {
			const id = String(d.id);
			if (seen.has(id)) continue;
			seen.add(id);
			out.push({
				id,
				deal_name: String(d.Deal_Name || ''),
				stage: String(d.Stage || '').trim(),
				contact_name: extractContactName(d.Contact_Name)
			});
		}

		if (batch.length < COQL_PAGE_SIZE) break;
	}

	out.sort((a, b) => a.deal_name.localeCompare(b.deal_name));
	return out;
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const bypassCache = url.searchParams.get('fresh') === '1';

	try {
		if (!bypassCache && cache && cache.expiresAt > Date.now()) {
			return json({
				data: cache.data,
				excludedStages: EXCLUDE_STAGES,
				cached: true,
				cacheAgeMs: CACHE_TTL_MS - (cache.expiresAt - Date.now())
			});
		}

		const { accessToken, apiDomain } = await ensureAccessToken();
		const data = await fetchDealsViaCoql(accessToken, apiDomain);

		cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };

		return json({ data, excludedStages: EXCLUDE_STAGES, cached: false });
	} catch (err) {
		console.error('GET /api/admin/bot/deals error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch deals';
		return json({ message }, { status: 500 });
	}
};
