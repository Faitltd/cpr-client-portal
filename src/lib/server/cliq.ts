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
