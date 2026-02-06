import { json } from '@sveltejs/kit';
import {
	getSalesiqTokens,
	upsertSalesiqTokens,
	getLatestSalesiqConversationForChannel
} from '$lib/server/db';
import { refreshSalesiqAccessToken, salesiqApiCall } from '$lib/server/salesiq';
import { CLIQ_IGNORE_EMAILS } from '$env/static/private';
import type { RequestHandler } from './$types';

const parseEmailList = (value: string | undefined) =>
	(value || '')
		.split(',')
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

const extractText = (payload: any) =>
	payload?.text ||
	payload?.data?.text ||
	payload?.message?.text ||
	payload?.data?.message?.text ||
	payload?.data?.content?.text ||
	payload?.content?.text ||
	null;

const extractChannelId = (payload: any) =>
	payload?.channel_id ||
	payload?.data?.channel_id ||
	payload?.data?.channel?.id ||
	payload?.channel?.id ||
	payload?.data?.chat?.id ||
	payload?.chat?.id ||
	null;

const extractSenderEmail = (payload: any) =>
	payload?.sender?.email ||
	payload?.data?.sender?.email ||
	payload?.data?.sender?.email_id ||
	payload?.sender?.email_id ||
	payload?.user?.email ||
	payload?.data?.user?.email ||
	null;

const extractSenderName = (payload: any) =>
	payload?.sender?.name ||
	payload?.data?.sender?.name ||
	payload?.user?.name ||
	payload?.data?.user?.name ||
	'Team';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) {
		return json({ ok: false, reason: 'invalid_payload' }, { status: 400 });
	}

	const messageText = extractText(body);
	const channelId = extractChannelId(body);
	const senderEmail = extractSenderEmail(body)?.toLowerCase() || '';
	const senderName = extractSenderName(body);

	if (!messageText || !channelId) {
		return json({ ok: true });
	}

	const ignoreEmails = parseEmailList(CLIQ_IGNORE_EMAILS);
	if (senderEmail && ignoreEmails.includes(senderEmail)) {
		return json({ ok: true });
	}

	const conversation = await getLatestSalesiqConversationForChannel(channelId);
	if (!conversation) {
		return json({ ok: true });
	}

	const salesiqTokens = await getSalesiqTokens();
	if (!salesiqTokens) {
		return json({ ok: false, reason: 'missing_salesiq_tokens' }, { status: 500 });
	}

	let salesiqAccessToken = salesiqTokens.access_token;
	if (new Date(salesiqTokens.expires_at) < new Date()) {
		const refreshed = await refreshSalesiqAccessToken(salesiqTokens.refresh_token);
		salesiqAccessToken = refreshed.access_token;
		await upsertSalesiqTokens({
			user_id: salesiqTokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: salesiqTokens.scope
		});
	}

	// Send staff reply into SalesIQ conversation
	const outboundText = `${senderName}: ${messageText}`;
	await salesiqApiCall(salesiqAccessToken, `/conversations/${conversation.conversation_id}/messages`, {
		method: 'POST',
		body: JSON.stringify({ text: outboundText })
	});

	return json({ ok: true });
};

export const HEAD: RequestHandler = async () => {
	return new Response(null, { status: 200 });
};
