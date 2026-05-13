import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { getAccessTokenAndDomain } from '$lib/server/zoho-field-updates';
import {
	postCliqChannelByName,
	postCliqChatMessage,
	postCliqChatViaRest,
	postCliqChatViaWebhook
} from '$lib/server/cliq';
import { getZohoTokens } from '$lib/server/db';
import { getTokenInfo } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

/**
 * Admin-only debug endpoint to test Cliq posting.
 *
 * POST /api/admin/cliq-test
 * body: {
 *   chatId?: string,
 *   channelName?: string,
 *   text?: string,
 *   mode?: 'auto' | 'rest' | 'rest_channel' | 'webhook'
 * }
 *
 * Returns a structured diagnostic including the scope Zoho says is on the
 * current access token (NOT just what we saved in our DB).
 */
export const POST: RequestHandler = async ({ cookies, request }) => {
	const adminToken = cookies.get('admin_session');
	if (!isValidAdminSession(adminToken)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const chatId = String(body?.chatId || env.ZOHO_CLIQ_CO_CHAT_ID || 'O5797744000003118001').trim();
	const channelName = String(body?.channelName || env.ZOHO_CLIQ_CO_CHANNEL_NAME || 'changeorders').trim();
	const text = String(body?.text || `Cliq connectivity test at ${new Date().toISOString()}`);
	const mode = String(body?.mode || 'auto');

	const tokens = await getZohoTokens();
	const savedScope = tokens?.scope ?? null;

	const { accessToken } = await getAccessTokenAndDomain();

	// Ask Zoho what scope is actually on the access token (authoritative — our
	// saved scope value can be stale or just the env-var fallback).
	let grantedScope: string | null = null;
	let grantedScopeError: string | null = null;
	try {
		const info = await getTokenInfo(accessToken);
		grantedScope = info?.scope ?? null;
	} catch (err) {
		grantedScopeError = err instanceof Error ? err.message : String(err);
	}

	let result;
	if (mode === 'webhook') {
		if (!env.ZOHO_CLIQ_CO_WEBHOOK_URL) {
			return json({ error: 'ZOHO_CLIQ_CO_WEBHOOK_URL not set' }, { status: 400 });
		}
		result = await postCliqChatViaWebhook(env.ZOHO_CLIQ_CO_WEBHOOK_URL, { text });
	} else if (mode === 'rest') {
		result = await postCliqChatViaRest(accessToken, chatId, { text });
	} else if (mode === 'rest_channel') {
		result = await postCliqChannelByName(accessToken, channelName, { text });
	} else {
		result = await postCliqChatMessage(accessToken, chatId, { text });
	}

	return json({
		chatId,
		channelName,
		mode,
		webhook_configured: !!env.ZOHO_CLIQ_CO_WEBHOOK_URL,
		channel_name_configured: !!env.ZOHO_CLIQ_CO_CHANNEL_NAME,
		scope_saved_in_db: savedScope,
		scope_actually_on_token: grantedScope,
		scope_lookup_error: grantedScopeError,
		result
	});
};
