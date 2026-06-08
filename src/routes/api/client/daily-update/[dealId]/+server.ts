import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { getPortalPrincipal } from '$lib/server/designer';
import { getDealsForClient } from '$lib/server/projects';
import { listWorkDriveFolder, extractWorkDriveFolderId } from '$lib/server/workdrive';
import { getOrCreateWorkDriveFileShare } from '$lib/server/workdrive-shares';
import { getCliqChatMessagesById } from '$lib/server/cliq';
import type { RequestHandler } from './$types';

// Global "field update" Cliq channel where every trade partner posts their
// site updates. Each post tags the client by name in the body — we filter
// by the deal's primary contact name when pulling messages for a client.
//
// Default chat id is CPR's production channel; override via env if needed.
const FIELDUPDATE_CHAT_ID =
	env.CLIQ_FIELDUPDATE_CHAT_ID || 'CT_2218628176537278664_868683004';

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
	subject?: string | null;
	channel: 'internal' | 'external' | 'mail' | 'field_update';
}

interface DailyPhoto {
	id: string;
	name: string;
	url: string;
	modifiedTime: string | null;
}

interface DailyUpdatePayload {
	summary: string;
	photos: DailyPhoto[];
	windowHours: number;
	sourceCount: number;
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

const SUMMARY_MODEL = env.DAILY_UPDATE_MODEL || 'gpt-4o-mini';

async function summariseActivity(messages: DailyMessage[], windowHours: number): Promise<string> {
	if (messages.length === 0) {
		return `No new updates in the last ${windowHours} hours.`;
	}
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		console.warn('[client/daily-update] OPENAI_API_KEY not set, returning empty summary');
		return '';
	}

	// Trim message bodies and order newest first so the model sees the
	// freshest signal at the top.
	const lines = messages.slice(0, 60).map((m) => {
		const author = m.author ?? 'CPR team';
		const subject = m.subject ? ` — Subject: ${m.subject}` : '';
		const body = m.body.replace(/\s+/g, ' ').slice(0, 600);
		const when = new Date(m.occurredAt).toISOString().slice(0, 16).replace('T', ' ');
		return `[${when}] ${author}${subject}: ${body}`;
	});

	const prompt = [
		`The following are recent updates from a home-renovation project, gathered from team chat, client emails, and trade-partner field reports over the last ${windowHours} hours.`,
		``,
		`Summarise the POSITIVE progress and concrete actions for the homeowner — what was done, what was ordered, what's coming next, who is on site. Skip any problems, complaints, delays, or unresolved issues; those are handled separately. Skip anything that's just chit-chat or scheduling logistics with no work content.`,
		``,
		`Format as 3-6 short bullet points using markdown "- " hyphens. Be concrete and specific. Use third person past tense. If there's truly nothing positive to share, return: "No new progress to report in the last ${windowHours} hours."`,
		``,
		`Updates:`,
		...lines
	].join('\n');

	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			signal: AbortSignal.timeout(20000),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: SUMMARY_MODEL,
				temperature: 0.2,
				messages: [
					{
						role: 'system',
						content:
							'You are a renovation-project assistant who writes short, factual, upbeat progress summaries for homeowners. You only include positive actions and concrete progress. You never mention problems, complaints, or delays.'
					},
					{ role: 'user', content: prompt }
				]
			})
		});
		if (!response.ok) {
			const txt = await response.text().catch(() => '');
			console.warn(`[client/daily-update] OpenAI ${response.status}: ${txt.slice(0, 200)}`);
			return '';
		}
		const payload = await response.json();
		const text = payload?.choices?.[0]?.message?.content;
		return typeof text === 'string' ? text.trim() : '';
	} catch (err) {
		console.warn('[client/daily-update] summary failed:', err);
		return '';
	}
}

function stripEmailHeaders(body: string): string {
	// zoho_mail bodies include "Subject: ... From: ... To: ..." headers at
	// the top. Strip them before showing to the client.
	return body
		.replace(/^Subject:\s*[^\n]*\n?/i, '')
		.replace(/^From:\s*[^\n]*\n?/im, '')
		.replace(/^To:\s*[^\n]*\n?/im, '')
		.replace(/^Cc:\s*[^\n]*\n?/im, '')
		.replace(/^Bcc:\s*[^\n]*\n?/im, '')
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/^\s*\n+/, '')
		.trim();
}

async function fetchRecentDealActivity(
	dealId: string,
	windowHours: number
): Promise<DailyMessage[]> {
	const cutoffIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
	// Pull from the deal's internal Cliq channel (CPR staff discussions),
	// external Cliq channel (CPR ↔ client conversations), AND email.
	const { data, error } = await supabase
		.from('bot_documents')
		.select('id, source, author, subject, occurred_at, body')
		.eq('deal_id', dealId)
		.in('source', ['zoho_cliq_internal', 'zoho_cliq_external', 'zoho_mail'])
		.gte('occurred_at', cutoffIso)
		.order('occurred_at', { ascending: false })
		.limit(150);
	if (error) {
		console.warn('[client/daily-update] activity query failed:', error.message);
		return [];
	}
	const out: DailyMessage[] = [];
	for (const row of data ?? []) {
		const rawBody = String((row as any).body ?? '').trim();
		if (!rawBody) continue;
		const source = String((row as any).source ?? '');
		const isMail = source === 'zoho_mail';
		const body = isMail ? stripEmailHeaders(rawBody) : rawBody;
		if (!body) continue;
		if (NEGATIVE_RE.test(body)) continue;
		const channel: DailyMessage['channel'] =
			source === 'zoho_cliq_internal'
				? 'internal'
				: source === 'zoho_cliq_external'
					? 'external'
					: 'mail';
		out.push({
			id: `${channel}:${(row as any).id}`,
			occurredAt: String((row as any).occurred_at),
			author: ((row as any).author as string | null) ?? null,
			body,
			subject: ((row as any).subject as string | null) ?? null,
			channel
		});
	}
	return out;
}

function buildClientNameMatchers(...names: Array<string | null | undefined>): RegExp[] {
	const seen = new Set<string>();
	const matchers: RegExp[] = [];
	for (const raw of names) {
		if (!raw) continue;
		const cleaned = String(raw)
			.replace(/[^\w\s'\-]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!cleaned) continue;
		const tokens = cleaned.split(' ').filter((t) => t.length >= 3);
		for (const tok of tokens) {
			const key = tok.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			matchers.push(new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i'));
		}
		// Also match the full phrase if it's a multi-word name (better signal).
		if (tokens.length > 1) {
			const key = cleaned.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				matchers.push(new RegExp(`\\b${cleaned.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i'));
			}
		}
	}
	return matchers;
}

interface DealNames {
	dealName: string | null;
	firstName: string | null;
	lastName: string | null;
	contactName: string | null;
}

async function fetchDealNames(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<DealNames> {
	try {
		const res = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,First_Name,Last_Name,Contact_Name,Partner_s_Last_Name,Partner_s_First_Name`,
			{},
			apiDomain
		);
		const rec = res?.data?.[0] ?? {};
		const contactName =
			typeof rec.Contact_Name === 'object' && rec.Contact_Name?.name
				? String(rec.Contact_Name.name)
				: typeof rec.Contact_Name === 'string'
					? rec.Contact_Name
					: null;
		return {
			dealName: typeof rec.Deal_Name === 'string' ? rec.Deal_Name : null,
			firstName: typeof rec.First_Name === 'string' ? rec.First_Name : null,
			lastName: typeof rec.Last_Name === 'string' ? rec.Last_Name : null,
			contactName
		};
	} catch {
		return { dealName: null, firstName: null, lastName: null, contactName: null };
	}
}

async function fetchFieldUpdateCliqMessages(
	accessToken: string,
	deal: DealNames,
	windowHours: number
): Promise<DailyMessage[]> {
	if (!FIELDUPDATE_CHAT_ID) return [];
	const fromTime = Date.now() - windowHours * 60 * 60 * 1000;
	const result = await getCliqChatMessagesById(accessToken, FIELDUPDATE_CHAT_ID, {
		fromTime,
		limit: 100
	}).catch((err) => {
		console.warn('[client/daily-update] fieldupdate channel fetch failed:', err);
		return null;
	});
	if (!result || !result.ok) {
		if (result && !result.ok) {
			console.warn(
				`[client/daily-update] fieldupdate channel ${result.status ?? ''}: ${result.error}`
			);
		}
		return [];
	}
	// Trade partners post in a fixed template — the message body starts with
	// "Project: <Deal Name>" (sometimes "Mark Guikema" / "Bill Douglas" etc).
	// Match the project line first; fall back to scattered name tokens if the
	// template isn't followed.
	const namesForFallback = buildClientNameMatchers(
		deal.dealName,
		deal.contactName,
		deal.firstName,
		deal.lastName,
		deal.firstName && deal.lastName ? `${deal.firstName} ${deal.lastName}` : null
	);
	const projectLineMatchers = buildClientNameMatchers(
		deal.dealName,
		deal.contactName,
		deal.firstName && deal.lastName ? `${deal.firstName} ${deal.lastName}` : null,
		deal.lastName
	);

	function matchesThisDeal(body: string): boolean {
		// Preferred: extract the "Project: <something>" line and match the
		// project name against the deal name / contact name.
		const projMatch = body.match(/Project\s*[:\-]\s*([^\n\r]+)/i);
		if (projMatch) {
			const projectName = projMatch[1].trim();
			if (projectLineMatchers.some((rx) => rx.test(projectName))) return true;
			// Don't fall back if the template was followed but didn't match —
			// the post belongs to a different client.
			return false;
		}
		// Fallback: free-form message; check anywhere in the body.
		return namesForFallback.some((rx) => rx.test(body));
	}

	const out: DailyMessage[] = [];
	for (const msg of result.messages) {
		const bodyText =
			typeof (msg as any).text === 'string'
				? (msg as any).text
				: typeof (msg as any).content?.text === 'string'
					? (msg as any).content.text
					: typeof (msg as any).body === 'string'
						? (msg as any).body
						: '';
		const body = String(bodyText).trim();
		if (!body) continue;
		if (!matchesThisDeal(body)) continue;
		if (NEGATIVE_RE.test(body)) continue;
		const id = String((msg as any).id ?? (msg as any).message_id ?? '');
		const time = (msg as any).time ?? (msg as any).timestamp ?? null;
		const occurredAt =
			typeof time === 'number'
				? new Date(time).toISOString()
				: typeof time === 'string'
					? new Date(Number(time) || time).toISOString()
					: new Date().toISOString();
		const author =
			typeof (msg as any).sender?.name === 'string'
				? (msg as any).sender.name
				: typeof (msg as any).author === 'string'
					? (msg as any).author
					: null;
		out.push({
			id: `fieldupdate:${id}`,
			occurredAt,
			author,
			body,
			channel: 'field_update'
		});
	}
	return out;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif?f)$/i;
const IMAGE_MIME_RE = /^image\//i;

const FIELD_UPDATES_MODULES = (() => {
	const envValue = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
	const set = new Set<string>(
		envValue.split(',').map((v) => v.trim()).filter(Boolean)
	);
	set.add('Field_Updates');
	for (let i = 1; i <= 10; i += 1) set.add(`Field_Updates${i}`);
	return Array.from(set);
})();

/**
 * Pull Supabase-stored photos uploaded via the trade portal in the past
 * window. These are the actual binaries referenced in the Cliq "Site
 * Visit/Progress Update" cards — when a trade partner submits a field
 * update from the portal, the photo bytes go to Supabase Storage and a
 * Zoho CRM record is created with a pointer.
 *
 * Supabase Storage URLs work without Zoho auth so we can hand them straight
 * to the client UI as <img src>.
 */
async function fetchSupabaseFieldUpdatePhotos(
	dealId: string,
	windowHours: number
): Promise<DailyPhoto[]> {
	const { getFieldUpdatesByDeal } = await import('$lib/server/db');
	const updates = await getFieldUpdatesByDeal(dealId).catch(() => [] as any[]);
	const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
	const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv', 'hevc']);
	const photos: DailyPhoto[] = [];
	const seen = new Set<string>();
	for (const u of updates) {
		const createdRaw = (u as any).created_at;
		const createdMs = typeof createdRaw === 'string' ? Date.parse(createdRaw) : Number.NaN;
		if (Number.isFinite(createdMs) && createdMs < cutoff) continue;
		const ids: string[] = Array.isArray((u as any).photo_ids) ? (u as any).photo_ids : [];
		for (const id of ids) {
			if (!id || seen.has(id)) continue;
			const ext = id.split('.').pop()?.toLowerCase() ?? '';
			if (VIDEO_EXTS.has(ext)) continue;
			seen.add(id);
			photos.push({
				id: `supa:${id}`,
				name: id.split('/').pop() ?? 'Photo',
				url: `/api/trade/photos/storage/${encodeURIComponent(id)}`,
				modifiedTime: typeof createdRaw === 'string' ? createdRaw : null
			});
		}
	}
	return photos;
}

/**
 * Find EVERY folder under the deal root whose name is "Photos" (case-
 * insensitive), recursing up to 2 levels. CPR's WorkDrive vintage varies —
 * some deals have Photos at the root, some under "Client Portal", and the
 * top-level one is sometimes empty. We collect from all of them.
 */
async function collectPhotosFolderIds(
	accessToken: string,
	rootFolderId: string,
	apiDomain?: string
): Promise<string[]> {
	const found: string[] = [];
	const visit = async (folderId: string, depth: number): Promise<void> => {
		if (depth > 2) return;
		const items = await listWorkDriveFolder(accessToken, folderId, apiDomain).catch(() => []);
		for (const it of items) {
			if (it.type !== 'folder') continue;
			if (/^photos$/i.test(it.name)) {
				found.push(it.id);
				continue;
			}
			// Recurse one more level so we find the nested ones (e.g.
			// `Client Portal/Photos`) even when no top-level Photos exists.
			await visit(it.id, depth + 1);
		}
	};
	await visit(rootFolderId, 0);
	return found;
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

	const photosFolderIds = await collectPhotosFolderIds(accessToken, rootId, apiDomain);
	if (photosFolderIds.length === 0) return [];

	const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
	const photos: DailyPhoto[] = [];
	const seenIds = new Set<string>();
	for (const folderId of photosFolderIds) {
		const items = await listWorkDriveFolder(accessToken, folderId, apiDomain).catch(() => []);
		for (const it of items) {
			if (it.type !== 'file') continue;
			if (seenIds.has(it.id)) continue;
			const isImage =
				IMAGE_EXT_RE.test(it.name) ||
				(typeof it.mime === 'string' && IMAGE_MIME_RE.test(it.mime));
			if (!isImage) continue;
			const modifiedMs = it.modifiedTime ? Date.parse(it.modifiedTime) : Number.NaN;
			if (Number.isFinite(modifiedMs) && modifiedMs < cutoff) continue;
			seenIds.add(it.id);
			photos.push({
				id: it.id,
				name: it.name,
				url: '', // filled in below
				modifiedTime: it.modifiedTime ?? null
			});
		}
	}

	// Sort newest first BEFORE minting external shares so the top images get
	// real URLs even if we hit the share-mint cap.
	photos.sort((a, b) => {
		const aT = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
		const bT = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
		return bT - aT;
	});
	const top = photos.slice(0, 18);

	// Mint (or look up cached) external share URLs — clients have no Zoho
	// account so the internal /file/{id} URL is useless to them.
	await Promise.all(
		top.map(async (p) => {
			const external = await getOrCreateWorkDriveFileShare({
				accessToken,
				apiDomain,
				fileId: p.id,
				fileName: p.name
			}).catch(() => null);
			p.url = external ?? `https://workdrive.zoho.com/file/${encodeURIComponent(p.id)}`;
		})
	);
	return top;
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
		const internalMessages = await fetchRecentDealActivity(dealId, windowHours);

		let fieldUpdateMessages: DailyMessage[] = [];
		let photos: DailyPhoto[] = [];
		try {
			const { accessToken, apiDomain } = await getAccessToken();
			const deal = await fetchDealNames(accessToken, apiDomain, dealId);
			let workDrivePhotos: DailyPhoto[] = [];
			let supabasePhotos: DailyPhoto[] = [];
			[fieldUpdateMessages, workDrivePhotos, supabasePhotos] = await Promise.all([
				fetchFieldUpdateCliqMessages(accessToken, deal, windowHours),
				fetchWorkDrivePhotos(accessToken, apiDomain, dealId, windowHours),
				fetchSupabaseFieldUpdatePhotos(dealId, windowHours)
			]);
			// Merge by id; field-update uploads (most recent activity) win.
			const seen = new Set<string>();
			for (const p of [...supabasePhotos, ...workDrivePhotos]) {
				if (seen.has(p.id)) continue;
				seen.add(p.id);
				photos.push(p);
			}
			photos.sort((a, b) => {
				const aT = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
				const bT = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
				return bT - aT;
			});
		} catch (err) {
			console.warn('[client/daily-update] live fetch failed:', err);
		}

		// Merge, de-dupe by id (we prefixed each source so collisions are
		// impossible across sources), and sort newest first.
		const seen = new Set<string>();
		const messages: DailyMessage[] = [];
		for (const m of [...fieldUpdateMessages, ...internalMessages]) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			messages.push(m);
		}
		messages.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

		const summary = await summariseActivity(messages, windowHours);

		const payload: DailyUpdatePayload = {
			summary,
			photos,
			windowHours,
			sourceCount: messages.length
		};
		return json(payload);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load daily update';
		console.error('[client/daily-update] error', { dealId, message });
		return json({ message }, { status: 500 });
	}
};
