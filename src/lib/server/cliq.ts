import { env } from '$env/dynamic/private';

const DEFAULT_CLIQ_BASE = 'https://cliq.zoho.com/api/v2';
const CLIQ_TIMEOUT_MS = 10_000;

function getCliqBase(apiDomain?: string) {
	if (env.ZOHO_CLIQ_API_BASE) return env.ZOHO_CLIQ_API_BASE.replace(/\/$/, '');
	if (apiDomain) {
		// www.zohoapis.com → cliq.zoho.com — Zoho serves Cliq under a separate hostname,
		// so we don't blindly swap CRM/Books domains. Caller can override via env.
	}
	return DEFAULT_CLIQ_BASE;
}

/**
 * Post a plain-text message to a Zoho Cliq chat by its chat ID.
 *
 * Requires the OAuth token to include the `ZohoCliq.Messages.CREATE` scope.
 * Returns the parsed JSON response on success, or throws.
 *
 * Zoho Cliq REST API docs:
 *   POST {base}/chats/{chat_id}/message
 *   body: { text: "..." }
 */
export async function postCliqChatMessage(
	accessToken: string,
	chatId: string,
	message: { text: string; bot?: { name?: string; image?: string } },
	apiDomain?: string
) {
	const base = getCliqBase(apiDomain);
	const url = `${base}/chats/${encodeURIComponent(chatId)}/message`;
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
		throw new Error(`Cliq post failed: ${response.status} ${errorText}`);
	}

	return response.json().catch(() => null);
}
