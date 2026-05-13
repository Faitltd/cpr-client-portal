import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { getAccessTokenAndDomain } from '$lib/server/zoho-field-updates';
import { postCliqChatMessage, postCliqChatViaRest, postCliqChatViaWebhook } from '$lib/server/cliq';
import { getZohoTokens } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Admin-only debug endpoint to test Cliq posting.
 *
 * POST /api/admin/cliq-test
 * body: { chatId?: string, text?: string, mode?: 'auto'|'rest'|'webhook' }
 *
 * Returns a structured result so we can see why the post is failing.
 */
export const POST: RequestHandler = async ({ cookies, request }) => {
	const adminToken = cookies.get('admin_session');
	if (!isValidAdminSession(adminToken)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const chatId = String(body?.chatId || env.ZOHO_CLIQ_CO_CHAT_ID || 'O5797744000003118001').trim();
	const text = String(body?.text || `Cliq connectivity test from client portal at ${new Date().toISOString()}`);
	const mode = String(body?.mode || 'auto');

	const tokens = await getZohoTokens();
	const scope = tokens?.scope ?? null;

	const { accessToken } = await getAccessTokenAndDomain();

	let result;
	if (mode === 'webhook') {
		if (!env.ZOHO_CLIQ_CO_WEBHOOK_URL) {
			return json({ error: 'ZOHO_CLIQ_CO_WEBHOOK_URL not set' }, { status: 400 });
		}
		result = await postCliqChatViaWebhook(env.ZOHO_CLIQ_CO_WEBHOOK_URL, { text });
	} else if (mode === 'rest') {
		result = await postCliqChatViaRest(accessToken, chatId, { text });
	} else {
		result = await postCliqChatMessage(accessToken, chatId, { text });
	}

	return json({
		chatId,
		mode,
		scope,
		webhook_configured: !!env.ZOHO_CLIQ_CO_WEBHOOK_URL,
		result
	});
};
