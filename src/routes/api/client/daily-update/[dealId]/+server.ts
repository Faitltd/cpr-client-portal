import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getZohoTokens, upsertZohoTokens, getFieldUpdatesByDeal } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { getPortalPrincipal } from '$lib/server/designer';
import { getDealsForClient } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Client-facing "Today on site" feed.
 *
 * Returns the most recent Field_Updates entries for a deal that belongs to
 * the logged-in client, in the same shape the trade endpoint returns so the
 * shared <DailyUpdate /> component renders both portals identically.
 *
 * Photos: pulls trade-portal uploads from Supabase Storage (the bucket the
 * trade app writes to) and matches them to Zoho Field_Updates by timestamp
 * proximity (Zoho first, Supabase within 2 minutes after).
 */

const ZOHO_API_BASE = env.ZOHO_API_BASE || 'https://www.zohoapis.com';

// Field_Updates is a custom module — CPR's vintage may name it Field_Updates,
// Field_Updates1, etc. Try each candidate via the Deal related-list URL.
const FIELD_UPDATES_MODULES = (() => {
	const envValue = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
	const set = new Set<string>(
		envValue.split(',').map((v) => v.trim()).filter(Boolean)
	);
	set.add('Field_Updates');
	for (let i = 1; i <= 10; i += 1) set.add(`Field_Updates${i}`);
	return Array.from(set);
})();

interface DailyUpdateItem {
	id: string;
	createdAt: string | null;
	updatedAt: string | null;
	type: string | null;
	body: string | null;
	photos: Array<{ name: string; url: string }>;
}

async function getAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho tokens not configured');
	let accessToken = tokens.access_token;
	const apiDomain = tokens.api_domain || undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
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

function safeText(v: any): string | null {
	if (typeof v === 'string' && v.trim()) return v.trim();
	return null;
}

function normalizePhotos(rawPhoto: any, recordId: string): Array<{ name: string; url: string }> {
	if (!rawPhoto) return [];
	const items: any[] = Array.isArray(rawPhoto) ? rawPhoto : [rawPhoto];
	const out: Array<{ name: string; url: string }> = [];
	for (const item of items) {
		if (!item) continue;
		if (typeof item === 'string' && item.startsWith('http')) {
			out.push({ name: 'Photo', url: item });
			continue;
		}
		if (typeof item === 'object') {
			const url =
				safeText(item.url) ??
				safeText(item.download_url) ??
				safeText(item.preview_url) ??
				null;
			const name = safeText(item.file_name) ?? safeText(item.name) ?? 'Photo';
			if (url) out.push({ name, url });
		}
	}
	return out;
}

function inferType(record: Record<string, any>): string | null {
	return (
		safeText(record.Update_Type) ??
		safeText(record.update_type) ??
		safeText(record.Type) ??
		null
	);
}

function normalize(record: Record<string, any>): DailyUpdateItem {
	const id = String(record?.id ?? '');
	return {
		id,
		createdAt: safeText(record.Created_Time) ?? safeText(record.created_time) ?? null,
		updatedAt: safeText(record.Modified_Time) ?? safeText(record.modified_time) ?? null,
		type: inferType(record),
		body: safeText(record.Note) ?? safeText(record.note) ?? null,
		photos: normalizePhotos(record.Photo ?? record.photo, id)
	};
}

async function fetchFieldUpdatesForDeal(
	accessToken: string,
	dealId: string,
	apiDomain?: string
): Promise<Record<string, any>[]> {
	const base = (apiDomain || ZOHO_API_BASE).replace(/\/$/, '');
	// Walk the candidate related-list URLs. Stop at the first one that returns
	// data (or 204 = no entries for the deal in that module).
	const errors: string[] = [];
	for (const moduleName of FIELD_UPDATES_MODULES) {
		const url = `${base}/crm/v8/Deals/${encodeURIComponent(dealId)}/${encodeURIComponent(moduleName)}?per_page=40&sort_by=Created_Time&sort_order=desc`;
		try {
			const response = await fetch(url, {
				method: 'GET',
				signal: AbortSignal.timeout(15000),
				headers: {
					Authorization: `Zoho-oauthtoken ${accessToken}`,
					'Content-Type': 'application/json'
				}
			});
			if (response.status === 204) {
				// Module exists but no entries for this deal — return empty cleanly.
				return [];
			}
			if (response.status === 404) {
				// Wrong module name — try the next candidate.
				continue;
			}
			if (!response.ok) {
				const text = await response.text().catch(() => '');
				errors.push(`${moduleName} -> ${response.status}: ${text.slice(0, 120)}`);
				continue;
			}
			const payload = await response.json().catch(() => null);
			const data = Array.isArray(payload?.data) ? payload.data : [];
			return data;
		} catch (err) {
			errors.push(`${moduleName} -> ${err instanceof Error ? err.message : 'fetch failed'}`);
		}
	}
	throw new Error(
		`No Field_Updates module returned data. Tried: ${errors.join(' | ').slice(0, 400)}`
	);
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const dealId = (params.dealId ?? '').trim();
	if (!dealId) return json({ message: 'Deal ID required' }, { status: 400 });

	const portalToken = cookies.get('portal_session');
	if (!portalToken) return json({ message: 'Not authenticated' }, { status: 401 });

	const principal = await getPortalPrincipal(portalToken);
	if (!principal || principal.role !== 'client') {
		return json({ message: 'Not authenticated as client' }, { status: 401 });
	}

	const client = principal.session.client as Record<string, any>;
	const allowed = await getDealsForClient(
		client.zoho_contact_id ?? client.zohoContactId ?? null,
		client.email ?? null
	).catch(() => [] as any[]);
	const allowedIds = new Set(
		(allowed ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
	);
	if (!allowedIds.has(dealId)) {
		return json({ message: 'Access denied' }, { status: 403 });
	}

	try {
		const { accessToken, apiDomain } = await getAccessToken();
		const raw = await fetchFieldUpdatesForDeal(accessToken, dealId, apiDomain);
		const normalized = raw.map(normalize).filter((u) => u.id);

		// Merge Supabase-stored photos (trade-portal uploads) by timestamp proximity.
		try {
			const supabaseUpdates = await getFieldUpdatesByDeal(dealId);
			const withPhotos = supabaseUpdates.filter(
				(r: any) => Array.isArray(r.photo_ids) && r.photo_ids.length > 0
			);
			if (withPhotos.length > 0) {
				const matched = new Set<string>();
				const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv', 'hevc']);
				for (const supaRec of withPhotos) {
					const supaTime = new Date(supaRec.created_at).getTime();
					let bestMatch: DailyUpdateItem | null = null;
					let bestScore = -Infinity;
					for (const item of normalized) {
						if (matched.has(item.id)) continue;
						const zohoTime = new Date(item.createdAt ?? 0).getTime();
						const diff = supaTime - zohoTime;
						if (diff < -30_000 || diff > 2 * 60_000) continue;
						let score = 2 * 60_000 - diff;
						const supaNote = (supaRec.note ?? '').trim();
						const zohoNote = (item.body ?? '').trim();
						if (supaNote && zohoNote && supaNote === zohoNote) score += 10 * 60_000;
						if (score > bestScore) {
							bestScore = score;
							bestMatch = item;
						}
					}
					if (bestMatch) {
						matched.add(bestMatch.id);
						const existingUrls = new Set(bestMatch.photos.map((p) => p.url));
						const newPhotos = (supaRec.photo_ids as string[])
							.filter((id: string) => {
								const ext = id.split('.').pop()?.toLowerCase() ?? '';
								return !VIDEO_EXTS.has(ext);
							})
							.map((id: string) => ({
								name: id.split('/').pop() ?? 'Photo',
								url: `/api/trade/photos/storage/${id}`
							}))
							.filter((p) => !existingUrls.has(p.url));
						bestMatch.photos = [...bestMatch.photos, ...newPhotos];
					}
				}
			}
		} catch (err) {
			console.warn('[client/daily-update] Supabase photo merge failed:', err);
		}

		normalized.sort((a, b) => {
			const aT = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime();
			const bT = new Date(b.createdAt ?? b.updatedAt ?? 0).getTime();
			return bT - aT;
		});

		return json({ data: normalized });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch updates';
		console.error('[client/daily-update] error', { dealId, message });
		return json({ message }, { status: 500 });
	}
};
