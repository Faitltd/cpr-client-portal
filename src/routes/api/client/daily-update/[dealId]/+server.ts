import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { getPortalPrincipal } from '$lib/server/designer';
import { getDealsForClient } from '$lib/server/projects';
import { listWorkDriveFolder, extractWorkDriveFolderId } from '$lib/server/workdrive';
import type { RequestHandler } from './$types';

/**
 * "Today on site" feed for the client dashboard.
 *
 * Pulls TWO data sources:
 *
 *  1. **Internal Cliq messages** for the deal's channel from the past
 *     {windowHours} — these are the team's daily progress notes. Already
 *     synced to Supabase by the bot cron, so we just query the database.
 *
 *  2. **WorkDrive Photos folder** — every image file in the deal's `Photos`
 *     top-level subfolder (the staff-curated progress photo set). Fetched
 *     live from the Zoho WorkDrive API.
 *
 * Output is filtered to positive progress only — any message containing a
 * problem / issue / delay keyword is dropped before sending to the client.
 */

const DEFAULT_WINDOW_HOURS = Number(env.DAILY_UPDATE_WINDOW_HOURS ?? '36');

const NEGATIVE_RE =
	/\b(problem|issue|broken|damag(e|ed|es)|delay(ed|s)?|fail(ed|ure|s)?|cracked|leak(ed|ing|s)?|missing|wrong|incorrect|holdup|stuck|blocked|concern|risk|hazard|injury|accident|complaint)\b/i;

interface DailyMessage {
	id: string;
	occurredAt: string;
	author: string | null;
	body: string;
}

interface DailyPhoto {
	id: string;
	name: string;
	url: string;
	modifiedTime: string | null;
}

interface DailyUpdatePayload {
	messages: DailyMessage[];
	photos: DailyPhoto[];
	windowHours: number;
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

async function fetchRecentCliqMessages(
	dealId: string,
	windowHours: number
): Promise<DailyMessage[]> {
	const cutoffIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from('bot_documents')
		.select('id, author, occurred_at, body')
		.eq('deal_id', dealId)
		.eq('source', 'zoho_cliq_internal')
		.gte('occurred_at', cutoffIso)
		.order('occurred_at', { ascending: false })
		.limit(80);
	if (error) {
		console.warn('[client/daily-update] cliq query failed:', error.message);
		return [];
	}
	const out: DailyMessage[] = [];
	for (const row of data ?? []) {
		const body = String((row as any).body ?? '').trim();
		if (!body) continue;
		if (NEGATIVE_RE.test(body)) continue;
		out.push({
			id: String((row as any).id),
			occurredAt: String((row as any).occurred_at),
			author: ((row as any).author as string | null) ?? null,
			body
		});
	}
	return out;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif?f)$/i;
const IMAGE_MIME_RE = /^image\//i;

async function findPhotosFolderId(
	accessToken: string,
	rootFolderId: string,
	apiDomain?: string
): Promise<string | null> {
	const visit = async (
		folderId: string,
		depth: number
	): Promise<string | null> => {
		if (depth > 2) return null;
		const items = await listWorkDriveFolder(accessToken, folderId, apiDomain).catch(() => []);
		// Look for a folder literally named "Photos" first (case-insensitive).
		for (const it of items) {
			if (it.type === 'folder' && /^photos$/i.test(it.name)) {
				return it.id;
			}
		}
		// Otherwise recurse one level into known parent folders that often host
		// a Photos subfolder (e.g. Client Portal).
		for (const it of items) {
			if (it.type !== 'folder') continue;
			if (/^(client portal|progress|site|jobsite|on.?site)$/i.test(it.name)) {
				const nested = await visit(it.id, depth + 1);
				if (nested) return nested;
			}
		}
		return null;
	};
	return visit(rootFolderId, 0);
}

async function fetchWorkDrivePhotos(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string,
	windowHours: number
): Promise<DailyPhoto[]> {
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=WorkDrive_Folder_ID`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const rawId = typeof rec.WorkDrive_Folder_ID === 'string' ? rec.WorkDrive_Folder_ID.trim() : '';
	const rootId = extractWorkDriveFolderId(rawId) || rawId || null;
	if (!rootId) return [];

	const photosFolderId = await findPhotosFolderId(accessToken, rootId, apiDomain);
	if (!photosFolderId) return [];

	const items = await listWorkDriveFolder(accessToken, photosFolderId, apiDomain).catch(() => []);
	const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
	const photos: DailyPhoto[] = [];
	for (const it of items) {
		if (it.type !== 'file') continue;
		const isImage =
			IMAGE_EXT_RE.test(it.name) || (typeof it.mime === 'string' && IMAGE_MIME_RE.test(it.mime));
		if (!isImage) continue;
		const modifiedMs = it.modifiedTime ? Date.parse(it.modifiedTime) : Number.NaN;
		// Treat undated files as "recent enough" so a new folder still renders
		// rather than appearing empty.
		if (Number.isFinite(modifiedMs) && modifiedMs < cutoff) continue;
		photos.push({
			id: it.id,
			name: it.name,
			url: `https://workdrive.zoho.com/file/${encodeURIComponent(it.id)}`,
			modifiedTime: it.modifiedTime ?? null
		});
	}
	photos.sort((a, b) => {
		const aT = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
		const bT = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
		return bT - aT;
	});
	return photos.slice(0, 18);
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
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

	const windowHours = Math.min(
		Math.max(Number(url.searchParams.get('hours') ?? DEFAULT_WINDOW_HOURS), 1),
		24 * 14
	);

	try {
		const messages = await fetchRecentCliqMessages(dealId, windowHours);
		let photos: DailyPhoto[] = [];
		try {
			const { accessToken, apiDomain } = await getAccessToken();
			photos = await fetchWorkDrivePhotos(accessToken, apiDomain, dealId, windowHours);
		} catch (err) {
			console.warn('[client/daily-update] photos fetch failed:', err);
		}
		const payload: DailyUpdatePayload = { messages, photos, windowHours };
		return json(payload);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load daily update';
		console.error('[client/daily-update] error', { dealId, message });
		return json({ message }, { status: 500 });
	}
};
