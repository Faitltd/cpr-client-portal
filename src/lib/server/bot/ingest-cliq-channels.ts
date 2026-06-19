import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/db';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import {
	getCliqChatMessagesById,
	listCliqChannels,
	type CliqMessageRead,
	type CliqChannelInfo
} from '$lib/server/cliq';
import { chunkText, embed } from './embeddings';

/**
 * Master-bot Cliq ingester. Pulls EVERY Cliq channel (org, team, private,
 * external) the bot account can see into the corpus so the admin Master Bot
 * can search across all of them — including company-wide channels like
 * "#Meeting Summaries" that aren't linked to any Deal.
 *
 * Per-Deal channels are also ingested by ingest-cliq.ts under their deal_id;
 * here they're stored a second time under a per-channel sentinel deal_id with
 * source `zoho_cliq_channel`. The per-Deal Deal Bot filters by deal_id so it
 * never sees these sentinel rows; only the cross-deal Master Bot does.
 */

const SOURCE = 'zoho_cliq_channel' as const;

const DEFAULT_BACKFILL_DAYS = Number(env.BOT_CLIQ_CHANNELS_BACKFILL_DAYS ?? '120');
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_CHANNEL = 20;
const RESYNC_OVERLAP_MS =
	Math.max(0, Number(env.BOT_CLIQ_OVERLAP_HOURS ?? '48')) * 60 * 60 * 1000;

// Optional filters (comma-separated channel unique_names). INCLUDE wins if set.
const INCLUDE = (env.BOT_CLIQ_CHANNELS_INCLUDE ?? '')
	.split(',')
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);
const EXCLUDE = (env.BOT_CLIQ_CHANNELS_EXCLUDE ?? '')
	.split(',')
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

function sentinelDealId(ch: CliqChannelInfo): string {
	return `__cliq__${ch.channelId ?? ch.chatId ?? ch.uniqueName ?? 'unknown'}`;
}

export interface ChannelIngestResult {
	name: string | null;
	uniqueName: string | null;
	level: string | null;
	dealId: string;
	processed: number;
	inserted: number;
	skipped: number;
	error?: string;
}

export interface CliqChannelsSyncResult {
	channelCount: number;
	inserted: number;
	skipped: number;
	channels: ChannelIngestResult[];
	error?: string;
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

/**
 * Some bots prefix a summary with a bare numeric transcript/meeting id on its
 * own first line. Strip it for a cleaner body, keep it in metadata.
 */
function splitLeadingId(text: string): { meetingId: string | null; body: string } {
	const lines = text.split('\n');
	const first = (lines[0] ?? '').trim();
	if (/^\d{6,}$/.test(first)) {
		return { meetingId: first, body: lines.slice(1).join('\n').trim() };
	}
	return { meetingId: null, body: text.trim() };
}

async function getCursorMs(dealId: string): Promise<number> {
	const { data } = await supabase
		.from('bot_ingest_cursors')
		.select('cursor')
		.eq('source', SOURCE)
		.eq('deal_id', dealId)
		.maybeSingle();

	let fromTime = Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000;
	if (data?.cursor) {
		try {
			const parsed = JSON.parse(data.cursor);
			if (parsed && typeof parsed === 'object' && typeof parsed.fromTime === 'number') {
				fromTime = parsed.fromTime;
			} else {
				const n = Number(data.cursor);
				if (Number.isFinite(n)) fromTime = n;
			}
		} catch {
			const n = Number(data.cursor);
			if (Number.isFinite(n)) fromTime = n;
		}
	}
	return fromTime;
}

async function setCursorMs(dealId: string, fromTime: number): Promise<void> {
	await supabase.from('bot_ingest_cursors').upsert(
		{
			source: SOURCE,
			deal_id: dealId,
			cursor: JSON.stringify({ fromTime }),
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'source,deal_id' }
	);
}

async function ingestOne(
	dealId: string,
	channelName: string | null,
	msg: CliqMessageRead
): Promise<'inserted' | 'skipped'> {
	const raw = msg.text;
	if (!raw || raw.length < 2) return 'skipped';

	const occurredAt = safeIsoFromMs(msg.time);
	if (!occurredAt) return 'skipped';

	const { meetingId, body } = splitLeadingId(raw);
	if (!body || body.length < 2) return 'skipped';

	const subject = `#${channelName ?? 'channel'} · ${occurredAt.slice(0, 10)}`;
	const docRow = {
		deal_id: dealId,
		source: SOURCE,
		source_id: msg.id,
		source_url: null as string | null,
		author: msg.sender_name,
		occurred_at: occurredAt,
		subject,
		body,
		metadata: {
			sender_id: msg.sender_id,
			meeting_id: meetingId,
			channel: channelName
		},
		hash: hashBody(body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', SOURCE)
		.eq('source_id', msg.id)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
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

async function syncOneChannel(
	accessToken: string,
	ch: CliqChannelInfo
): Promise<ChannelIngestResult> {
	const dealId = sentinelDealId(ch);
	const res: ChannelIngestResult = {
		name: ch.name,
		uniqueName: ch.uniqueName,
		level: ch.level,
		dealId,
		processed: 0,
		inserted: 0,
		skipped: 0
	};
	if (!ch.chatId) {
		res.error = 'no chat_id on channel';
		return res;
	}

	const stored = await getCursorMs(dealId);
	let fromTime = Math.min(stored, Date.now() - RESYNC_OVERLAP_MS);
	let latestSeen = fromTime;
	let pages = 0;

	while (pages < MAX_PAGES_PER_CHANNEL) {
		pages += 1;
		const msgRes = await getCliqChatMessagesById(accessToken, ch.chatId, {
			fromTime,
			limit: PAGE_LIMIT
		});
		if (!msgRes.ok) {
			res.error = `Cliq read failed${msgRes.status ? ` (HTTP ${msgRes.status})` : ''}: ${msgRes.error}`;
			break;
		}
		if (msgRes.messages.length === 0) break;

		for (const m of msgRes.messages) {
			res.processed += 1;
			try {
				const r = await ingestOne(dealId, ch.name, m);
				if (r === 'inserted') res.inserted += 1;
				else res.skipped += 1;
			} catch (err) {
				res.skipped += 1;
				console.warn(
					`[bot/ingest-cliq-channels] ${ch.name ?? dealId} msg ${m.id} failed:`,
					err instanceof Error ? err.message : err
				);
			}
			if (m.time > latestSeen) latestSeen = m.time;
		}
		if (msgRes.messages.length < PAGE_LIMIT) break;
		fromTime = latestSeen + 1;
	}

	if (latestSeen > 0) await setCursorMs(dealId, latestSeen);
	return res;
}

function channelAllowed(ch: CliqChannelInfo): boolean {
	const uname = (ch.uniqueName ?? '').toLowerCase();
	const name = (ch.name ?? '').toLowerCase();
	if (INCLUDE.length > 0) return INCLUDE.includes(uname) || INCLUDE.includes(name);
	if (EXCLUDE.length > 0 && (EXCLUDE.includes(uname) || EXCLUDE.includes(name))) return false;
	return true;
}

/**
 * Ingest every visible Cliq channel into the bot corpus. Idempotent
 * (deduped on source+source_id+hash) with a small re-scan overlap so dropped
 * messages self-heal. Channels are processed sequentially to keep embedding
 * throughput bounded.
 */
export async function syncAllCliqChannels(): Promise<CliqChannelsSyncResult> {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho not connected');
	const accessToken = valid.accessToken;

	const listed = await listCliqChannels(accessToken, { joinedOnly: true, status: 'created' });
	if (!listed.ok) {
		return { channelCount: 0, inserted: 0, skipped: 0, channels: [], error: listed.error };
	}

	const channels = listed.channels.filter(channelAllowed);
	const out: ChannelIngestResult[] = [];
	let inserted = 0;
	let skipped = 0;

	for (const ch of channels) {
		const r = await syncOneChannel(accessToken, ch);
		inserted += r.inserted;
		skipped += r.skipped;
		out.push(r);
	}

	return { channelCount: channels.length, inserted, skipped, channels: out };
}
