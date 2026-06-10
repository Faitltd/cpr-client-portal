import { createHash } from 'crypto';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { getCliqChannelMessages, type CliqMessageRead } from '$lib/server/cliq';
import { parseCliqChannelUrl } from '$lib/server/cliq-notifications';
import { chunkText, embed } from './embeddings';

const DEFAULT_BACKFILL_DAYS = Number(process.env.BOT_CLIQ_BACKFILL_DAYS ?? '90');
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 30;
// Re-scan this far behind the cursor every run. Ingestion is idempotent
// (deduped on source+source_id+hash), so the cost is a page or two of
// re-fetched messages — and it self-heals messages that a past run dropped
// (parse gaps, transient embed failures) without a manual cursor reset.
const RESYNC_OVERLAP_MS =
	Math.max(0, Number(process.env.BOT_CLIQ_OVERLAP_HOURS ?? '48')) * 60 * 60 * 1000;

type CliqSource = 'zoho_cliq_internal' | 'zoho_cliq_external';

export interface CliqSyncResult {
	dealId: string;
	internal: ChannelSyncResult;
	external: ChannelSyncResult;
}

export interface ChannelSyncResult {
	channelName: string | null;
	source: CliqSource;
	processed: number;
	inserted: number;
	skipped: number;
	error?: string;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');

	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;

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

interface ChannelHandle {
	channelName: string | null;
	chatId: string | null;
}

interface DealChannels {
	dealName: string | null;
	internal: ChannelHandle;
	external: ChannelHandle;
}

/**
 * Parse a CRM-stored Cliq value. Some Deals store a full URL
 *   (https://cliq.zoho.com/company/{co}/channels/{slug})
 * and some store just a bare chat_id like "E3000139312197" or "CT_1424...".
 */
function parseCliqValue(value: string): ChannelHandle {
	const trimmed = value.trim();
	if (!trimmed) return { channelName: null, chatId: null };
	const slug = parseCliqChannelUrl(trimmed);
	if (slug) return { channelName: slug, chatId: null };
	// Looks like a bare id? Cliq chat ids are alphanumeric, no slashes, ~10-30 chars.
	if (/^[A-Za-z0-9_-]{6,40}$/.test(trimmed)) {
		return { channelName: trimmed, chatId: trimmed };
	}
	return { channelName: null, chatId: null };
}

/**
 * Read Cliq channel handles off the Deal record. Internal uses
 * Cliq_Internal_Channel_ID; External uses Cliq_External_Channel_ID.
 */
async function fetchDealChannels(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<DealChannels> {
	const response = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,Cliq_Internal_Channel_ID,Cliq_External_Channel_ID,Cliq_Channel`,
		{},
		apiDomain
	);
	const rec = response?.data?.[0] ?? {};
	const internalRaw =
		typeof rec.Cliq_Internal_Channel_ID === 'string' ? rec.Cliq_Internal_Channel_ID : '';
	const externalRaw =
		typeof rec.Cliq_External_Channel_ID === 'string' ? rec.Cliq_External_Channel_ID : '';
	const legacy = typeof rec.Cliq_Channel === 'string' ? rec.Cliq_Channel.trim() : '';

	const internal = parseCliqValue(internalRaw);
	if (!internal.channelName && legacy) internal.channelName = legacy;
	const external = parseCliqValue(externalRaw);

	return {
		dealName: typeof rec.Deal_Name === 'string' ? rec.Deal_Name.trim() : null,
		internal,
		external
	};
}

interface CursorState {
	fromTime: number;
	chatId: string | null;
}

async function getCursor(source: CliqSource, dealId: string): Promise<CursorState> {
	const { data } = await supabase
		.from('bot_ingest_cursors')
		.select('cursor')
		.eq('source', source)
		.eq('deal_id', dealId)
		.maybeSingle();

	let fromTime = Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000;
	let chatId: string | null = null;
	if (data?.cursor) {
		try {
			const parsed = JSON.parse(data.cursor);
			if (parsed && typeof parsed === 'object') {
				if (typeof parsed.fromTime === 'number') fromTime = parsed.fromTime;
				if (typeof parsed.chatId === 'string') chatId = parsed.chatId;
			} else {
				const n = Number(data.cursor);
				if (Number.isFinite(n)) fromTime = n;
			}
		} catch {
			const n = Number(data.cursor);
			if (Number.isFinite(n)) fromTime = n;
		}
	}
	return { fromTime, chatId };
}

async function setCursor(
	source: CliqSource,
	dealId: string,
	state: CursorState
): Promise<void> {
	await supabase.from('bot_ingest_cursors').upsert(
		{
			source,
			deal_id: dealId,
			cursor: JSON.stringify(state),
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'source,deal_id' }
	);
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

function safeIsoFromMs(ms: number): string | null {
	if (!Number.isFinite(ms)) return null;
	if (ms < -8.64e15 || ms > 8.64e15) return null;
	const d = new Date(ms);
	if (Number.isNaN(d.getTime())) return null;
	return d.toISOString();
}

async function ingestOne(
	dealId: string,
	source: CliqSource,
	msg: CliqMessageRead
): Promise<'inserted' | 'skipped'> {
	const body = msg.text;
	if (!body || body.length < 2) return 'skipped';

	const occurredAt = safeIsoFromMs(msg.time);
	if (!occurredAt) {
		console.warn(`[bot/ingest-cliq] skipping ${source} msg ${msg.id}: bad time ${msg.time}`);
		return 'skipped';
	}
	const docRow = {
		deal_id: dealId,
		source,
		source_id: msg.id,
		source_url: null,
		author: msg.sender_name,
		occurred_at: occurredAt,
		subject: null as string | null,
		body,
		metadata: {
			sender_id: msg.sender_id,
			cliq_raw_type: msg.raw?.type ?? null
		},
		hash: hashBody(body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', msg.id)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;

	if (existing) {
		const { error } = await supabase
			.from('bot_documents')
			.update(docRow)
			.eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(body, 1200, 160);
	if (chunks.length === 0) return 'inserted';

	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);

	return 'inserted';
}

async function syncChannel(
	accessToken: string,
	dealId: string,
	source: CliqSource,
	handle: ChannelHandle
): Promise<ChannelSyncResult> {
	const base: ChannelSyncResult = {
		channelName: handle.channelName,
		source,
		processed: 0,
		inserted: 0,
		skipped: 0
	};
	if (!handle.channelName && !handle.chatId) {
		base.error = 'no channel id on Deal';
		return base;
	}

	const state = await getCursor(source, dealId);
	let fromTime = Math.min(state.fromTime, Date.now() - RESYNC_OVERLAP_MS);
	let chatId = state.chatId ?? handle.chatId ?? null;
	let latestSeen = fromTime;
	let pages = 0;

	while (pages < MAX_PAGES_PER_RUN) {
		pages += 1;
		const res = await getCliqChannelMessages(accessToken, handle.channelName ?? handle.chatId ?? '', {
			fromTime,
			limit: PAGE_LIMIT,
			chatId: chatId ?? undefined
		});
		if (!res.ok) {
			base.error = `Cliq read failed${res.status ? ` (HTTP ${res.status})` : ''}: ${res.error}`;
			break;
		}
		chatId = res.chatId;
		if (res.messages.length === 0) break;

		for (const m of res.messages) {
			base.processed += 1;
			try {
				const result = await ingestOne(dealId, source, m);
				if (result === 'inserted') base.inserted += 1;
				else base.skipped += 1;
			} catch (err) {
				base.skipped += 1;
				console.warn(
					`[bot/ingest-cliq] ${source} msg ${m.id} failed:`,
					err instanceof Error ? err.message : err
				);
			}
			if (m.time > latestSeen) latestSeen = m.time;
		}
		if (res.messages.length < PAGE_LIMIT) break;
		fromTime = latestSeen + 1;
	}

	if (chatId || latestSeen > 0) {
		await setCursor(source, dealId, {
			fromTime: latestSeen > 0 ? latestSeen : state.fromTime,
			chatId
		});
	}
	return base;
}

/**
 * Sync Cliq messages for one Deal — both Internal and External channels.
 * Idempotent: re-runs only fetch messages newer than the stored cursor.
 */
export async function syncCliqForDeal(dealId: string): Promise<CliqSyncResult> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const { internal, external } = await fetchDealChannels(accessToken, apiDomain, dealId);

	const internalRes = await syncChannel(accessToken, dealId, 'zoho_cliq_internal', internal);
	const externalRes = await syncChannel(accessToken, dealId, 'zoho_cliq_external', external);

	return { dealId, internal: internalRes, external: externalRes };
}
