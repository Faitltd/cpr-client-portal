import { env } from '$env/dynamic/private';

const DEFAULT_CLIQ_BASE = 'https://cliq.zoho.com/api/v2';
const CLIQ_TIMEOUT_MS = 10_000;

export type CliqPostResult =
	| { ok: true; via: 'rest' | 'webhook'; response?: any }
	| { ok: false; via: 'rest' | 'webhook'; status?: number; error: string };

function getCliqBase() {
	return (env.ZOHO_CLIQ_API_BASE || DEFAULT_CLIQ_BASE).replace(/\/$/, '');
}

/**
 * Post a plain-text message to a Zoho Cliq chat/channel via REST.
 * Uses {base}/chats/{chat_id}/message (works for chats and channel chats).
 * Requires OAuth scope ZohoCliq.Messages.CREATE.
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
				via: 'rest',
				status: response.status,
				error: errorText || `HTTP ${response.status}`
			};
		}

		const body = await response.json().catch(() => null);
		return { ok: true, via: 'rest', response: body };
	} catch (err) {
		return {
			ok: false,
			via: 'rest',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Post a plain-text message to a Zoho Cliq incoming webhook URL.
 * Does NOT need OAuth — the webhook URL itself authorizes the post.
 * Cliq incoming webhooks accept { text: "..." } in the body.
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
 * Try the webhook first if one is configured (no OAuth dependency); otherwise
 * fall back to the REST API call using the supplied access token.
 *
 * Returns a structured result rather than throwing, so callers can include
 * the outcome in their response payload for debugging.
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
	return postCliqChatViaRest(accessToken, chatId, message);
}
