import { env } from '$env/dynamic/private';

const DEFAULT_CLIQ_BASE = 'https://cliq.zoho.com/api/v2';
const CLIQ_TIMEOUT_MS = 10_000;

export type CliqPostVia = 'rest_chat' | 'rest_channel' | 'webhook';
export type CliqPostResult =
	| { ok: true; via: CliqPostVia; response?: any }
	| { ok: false; via: CliqPostVia; status?: number; error: string };

/**
 * Cliq message payload. `text` is required; everything else is optional
 * rich-content (slides, card, bot identity).
 *
 * Slides with type='images' embed inline image galleries into the channel.
 * Each URL in `data` must be publicly fetchable at post time — Cliq pulls
 * the image server-side when delivering the message.
 */
export interface CliqMessage {
	text: string;
	slides?: Array<
		| { type: 'images'; title?: string; data: string[] }
		| { type: 'video'; title?: string; data: string }
		| { type: 'label'; title?: string; data: Record<string, string> }
	>;
	card?: { title?: string; thumbnail?: string; theme?: string };
	bot?: { name?: string; image?: string };
}

function getCliqBase() {
	return (env.ZOHO_CLIQ_API_BASE || DEFAULT_CLIQ_BASE).replace(/\/$/, '');
}

/**
 * Post a message to a Zoho Cliq chat by chat ID.
 *   POST {base}/chats/{chat_id}/message
 * Requires scope: ZohoCliq.Messages.CREATE
 *
 * NOTE: This uses the *chat* ID (e.g. CT_1424...), NOT the channel ID
 * (e.g. O5797...). They are different identifiers in Cliq.
 */
export async function postCliqChatViaRest(
	accessToken: string,
	chatId: string,
	message: CliqMessage
): Promise<CliqPostResult> {
	const base = getCliqBase();
	const url = `${base}/chats/${encodeURIComponent(chatId)}/message`;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(message),
			signal: AbortSignal.timeout(CLIQ_TIMEOUT_MS)
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			return {
				ok: false,
				via: 'rest_chat',
				status: response.status,
				error: errorText || `HTTP ${response.status}`
			};
		}
		const body = await response.json().catch(() => null);
		return { ok: true, via: 'rest_chat', response: body };
	} catch (err) {
		return {
			ok: false,
			via: 'rest_chat',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Post a message to a Zoho Cliq *channel* by its unique name.
 *   POST {base}/channelsbyname/{name}/message
 */
export async function postCliqChannelByName(
	accessToken: string,
	channelName: string,
	message: CliqMessage
): Promise<CliqPostResult> {
	const base = getCliqBase();
	const url = `${base}/channelsbyname/${encodeURIComponent(channelName)}/message`;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(message),
			signal: AbortSignal.timeout(CLIQ_TIMEOUT_MS)
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			return {
				ok: false,
				via: 'rest_channel',
				status: response.status,
				error: errorText || `HTTP ${response.status}`
			};
		}
		const body = await response.json().catch(() => null);
		return { ok: true, via: 'rest_channel', response: body };
	} catch (err) {
		return {
			ok: false,
			via: 'rest_channel',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Post to a Zoho Cliq incoming webhook URL — does NOT need OAuth.
 */
export async function postCliqChatViaWebhook(
	webhookUrl: string,
	message: CliqMessage
): Promise<CliqPostResult> {
	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(message),
			signal: AbortSignal.timeout(CLIQ_TIMEOUT_MS)
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			return {
				ok: false,
				via: 'webhook',
				status: response.status,
				error: errorText || `HTTP ${response.status}`
			};
		}
		const body = await response.json().catch(() => null);
		return { ok: true, via: 'webhook', response: body };
	} catch (err) {
		return {
			ok: false,
			via: 'webhook',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Default Cliq post — picks the best available channel for the config:
 *   1. ZOHO_CLIQ_CO_WEBHOOK_URL → webhook
 *   2. ZOHO_CLIQ_CO_CHANNEL_NAME → channelsbyname
 *   3. fall back to chats/{chatId}/message
 */
export async function postCliqChatMessage(
	accessToken: string,
	chatId: string,
	message: CliqMessage
): Promise<CliqPostResult> {
	const webhook = env.ZOHO_CLIQ_CO_WEBHOOK_URL;
	if (webhook) {
		const result = await postCliqChatViaWebhook(webhook, message);
		if (result.ok) return result;
		console.warn('[cliq] webhook post failed, falling back to REST:', result.error);
	}

	const channelName = env.ZOHO_CLIQ_CO_CHANNEL_NAME;
	if (channelName) {
		return postCliqChannelByName(accessToken, channelName, message);
	}

	return postCliqChatViaRest(accessToken, chatId, message);
}

/**
 * One Cliq message, normalized for ingestion. The full Zoho payload is much
 * richer (formatted_content, attachments, slides, reactions), but for vector
 * search we only need plain text + sender + timestamp + a stable id.
 */
export interface CliqMessageRead {
	id: string;
	time: number; // epoch ms
	sender_id: string | null;
	sender_name: string | null;
	text: string;
	raw: any;
}

function pickPlainText(msg: any): string {
	if (typeof msg?.content?.text === 'string') return msg.content.text;
	if (typeof msg?.text === 'string') return msg.text;
	if (typeof msg?.content === 'string') return msg.content;
	if (typeof msg?.message === 'string') return msg.message;
	return '';
}

/**
 * Coerce a Cliq timestamp to epoch ms. Cliq's payloads have used number-of-ms,
 * number-of-seconds, microseconds, and ISO strings in different responses; we
 * accept all and return ms in the JS-Date-safe range.
 */
function coerceCliqTime(value: unknown): number | null {
	if (value == null) return null;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (/^\d+$/.test(trimmed)) return coerceCliqTime(Number(trimmed));
		const parsed = Date.parse(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}

	if (typeof value !== 'number' || !Number.isFinite(value)) return null;

	let n = value;
	if (n > 1e18) n = Math.floor(n / 1e6);        // nanoseconds → ms
	else if (n > 1e15) n = Math.floor(n / 1e3);   // microseconds → ms
	else if (n < 1e11) n = Math.floor(n * 1000);  // seconds → ms

	// JS Date safe range is ±8.64e15 ms from epoch.
	if (n < -8.64e15 || n > 8.64e15) return null;
	const probe = new Date(n);
	if (Number.isNaN(probe.getTime())) return null;
	return n;
}

function normalizeReadMessage(raw: any): CliqMessageRead | null {
	if (!raw || typeof raw !== 'object') return null;
	const id = raw.id ?? raw.message_id ?? raw.msg_uid;
	if (!id) return null;
	const t = raw.time ?? raw.timestamp ?? raw.sent_time ?? raw.created_time;
	const time = coerceCliqTime(t);
	if (time == null) return null;
	const senderId =
		raw.sender?.id ?? raw.sender_id ?? raw.from?.id ?? raw.from_user_id ?? null;
	const senderName =
		raw.sender?.name ??
		raw.sender_name ??
		raw.from?.name ??
		raw.from_user_name ??
		raw.display_name ??
		null;
	const text = pickPlainText(raw).trim();
	return {
		id: String(id),
		time,
		sender_id: senderId != null ? String(senderId) : null,
		sender_name: senderName != null ? String(senderName) : null,
		text,
		raw
	};
}

async function cliqGet(
	accessToken: string,
	path: string
): Promise<{ ok: true; body: any } | { ok: false; status?: number; error: string }> {
	const base = getCliqBase();
	const url = `${base}${path}`;
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), CLIQ_TIMEOUT_MS);
		const response = await fetch(url, {
			method: 'GET',
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
			signal: controller.signal
		});
		clearTimeout(timeout);
		const text = await response.text();
		let body: any = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			body = text;
		}
		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				error: typeof body === 'string' ? body : JSON.stringify(body)
			};
		}
		return { ok: true, body };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
	}
}

/**
 * Resolve a Cliq channel's unique name (the URL slug) to its `chat_id`.
 *   GET {base}/channelsbyname/{name}
 * Requires scope: ZohoCliq.Channels.READ
 */
export async function getCliqChannelByName(
	accessToken: string,
	channelName: string
): Promise<
	| { ok: true; channelId: string | null; chatId: string | null; raw: any }
	| { ok: false; status?: number; error: string }
> {
	const res = await cliqGet(accessToken, `/channelsbyname/${encodeURIComponent(channelName)}`);
	if (!res.ok) return res;
	const data = res.body?.data ?? res.body?.channel ?? res.body ?? {};
	const channelId =
		data.channel_id ?? data.id ?? data.unique_name ?? null;
	const chatId = data.chat_id ?? data.chatid ?? data.chat?.id ?? null;
	return {
		ok: true,
		channelId: channelId != null ? String(channelId) : null,
		chatId: chatId != null ? String(chatId) : null,
		raw: data
	};
}

/**
 * Resolve a Cliq channel by its channel ID (e.g. "E3000139312197" for an
 * external channel) to its `chat_id`.
 *   GET {base}/channels/{channel_id}
 */
export async function getCliqChannelById(
	accessToken: string,
	channelId: string
): Promise<
	| { ok: true; channelId: string | null; chatId: string | null; raw: any }
	| { ok: false; status?: number; error: string }
> {
	const res = await cliqGet(accessToken, `/channels/${encodeURIComponent(channelId)}`);
	if (!res.ok) return res;
	const data = res.body?.data ?? res.body?.channel ?? res.body ?? {};
	const id = data.channel_id ?? data.id ?? channelId;
	const chatId = data.chat_id ?? data.chatid ?? data.chat?.id ?? null;
	return {
		ok: true,
		channelId: id != null ? String(id) : null,
		chatId: chatId != null ? String(chatId) : null,
		raw: data
	};
}

/**
 * Read messages from a Cliq chat by its `chat_id`. Pages forward.
 *   GET {base}/chats/{chat_id}/messages?fromtime={epoch_ms}&limit=100
 * Requires scope: ZohoCliq.Messages.READ
 */
export async function getCliqChatMessagesById(
	accessToken: string,
	chatId: string,
	opts: { fromTime?: number; limit?: number } = {}
): Promise<{ ok: true; messages: CliqMessageRead[] } | { ok: false; status?: number; error: string }> {
	const limit = Math.min(opts.limit ?? 100, 100);
	const params = new URLSearchParams({ limit: String(limit) });
	if (opts.fromTime) params.set('fromtime', String(opts.fromTime));
	const res = await cliqGet(
		accessToken,
		`/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`
	);
	if (!res.ok) return res;

	const rawList: any[] = Array.isArray(res.body?.data)
		? res.body.data
		: Array.isArray(res.body?.messages)
			? res.body.messages
			: Array.isArray(res.body)
				? res.body
				: [];

	const messages = rawList
		.map(normalizeReadMessage)
		.filter((m): m is CliqMessageRead => m !== null);

	return { ok: true, messages };
}

/**
 * Convenience: resolve a channel unique-name to its chat_id, then read
 * messages. Caches no state — caller may want to remember chat_id.
 *
 * Returns the chat_id on success so callers can persist it.
 */
export async function getCliqChannelMessages(
	accessToken: string,
	channelName: string,
	opts: { fromTime?: number; limit?: number; chatId?: string } = {}
): Promise<
	| { ok: true; messages: CliqMessageRead[]; chatId: string }
	| { ok: false; status?: number; error: string }
> {
	let chatId = opts.chatId ?? null;

	// If the "chatId" hint looks like a channel id (starts with E/O/etc and
	// not the CT_ prefix that real chat ids use), resolve it first.
	if (chatId && !chatId.startsWith('CT_')) {
		const lookup = await getCliqChannelById(accessToken, chatId);
		if (lookup.ok && lookup.chatId) {
			chatId = lookup.chatId;
		} else {
			chatId = null; // fall through to channelName lookup
		}
	}

	if (!chatId) {
		const lookup = await getCliqChannelByName(accessToken, channelName);
		if (!lookup.ok) return lookup;
		if (!lookup.chatId) {
			return {
				ok: false,
				error: `channel "${channelName}" has no chat_id in response: ${JSON.stringify(lookup.raw).slice(0, 200)}`
			};
		}
		chatId = lookup.chatId;
	}

	const msgRes = await getCliqChatMessagesById(accessToken, chatId, {
		fromTime: opts.fromTime,
		limit: opts.limit
	});
	if (!msgRes.ok) return msgRes;
	return { ok: true, messages: msgRes.messages, chatId };
}
