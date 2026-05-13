import { env } from '$env/dynamic/private';

const DEFAULT_CLIQ_BASE = 'https://cliq.zoho.com/api/v2';
const CLIQ_TIMEOUT_MS = 10_000;

export type CliqPostVia = 'rest_chat' | 'rest_channel' | 'webhook';
export type CliqPostResult =
	| { ok: true; via: CliqPostVia; response?: any }
	| { ok: false; via: CliqPostVia; status?: number; error: string };

function getCliqBase() {
	return (env.ZOHO_CLIQ_API_BASE || DEFAULT_CLIQ_BASE).replace(/\/$/, '');
}

/**
 * Post a plain-text message to a Zoho Cliq chat by chat ID.
 *   POST {base}/chats/{chat_id}/message
 * Requires scope: ZohoCliq.Messages.CREATE
 *
 * NOTE: This uses the *chat* ID (e.g. CT_1424...), NOT the channel ID
 * (e.g. O5797...). They are different identifiers in Cliq.
 */
export async function postCliqChatViaRest(
	accessToken: string,
	chatId: string,
	message: { text: string }
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
 * Post a plain-text message to a Zoho Cliq *channel* by its unique name.
 *   POST {base}/channelsbyname/{name}/message
 * Requires scope: ZohoCliq.Channels.MESSAGE or ZohoCliq.Messages.CREATE (varies by Zoho doc revision).
 */
export async function postCliqChannelByName(
	accessToken: string,
	channelName: string,
	message: { text: string }
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
 * Post a plain-text message to a Zoho Cliq incoming webhook URL.
 * Does NOT need OAuth — the webhook URL itself authorizes the post.
 */
export async function postCliqChatViaWebhook(
	webhookUrl: string,
	message: { text: string }
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
 * Default Cliq post — tries the best available channel for the configuration:
 *   1. If ZOHO_CLIQ_CO_WEBHOOK_URL is set → use it (no OAuth needed)
 *   2. Else if ZOHO_CLIQ_CO_CHANNEL_NAME is set → use channelsbyname endpoint
 *   3. Else fall back to the chat-ID endpoint with the supplied chatId
 *
 * Returns a structured result so callers can include the outcome in their
 * response payload.
 */
export async function postCliqChatMessage(
	accessToken: string,
	chatId: string,
	message: { text: string }
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
