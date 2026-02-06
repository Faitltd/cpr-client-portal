import { json, error } from '@sveltejs/kit';
import {
	getCliqTokens,
	upsertCliqTokens,
	getClientByEmail,
	getClientCliqChannel,
	upsertClientCliqChannel,
	upsertSalesiqConversation
} from '$lib/server/db';
import { refreshCliqAccessToken, createCliqChannel, findCliqChannelByName, postCliqChannelMessage } from '$lib/server/cliq';
import {
	CLIQ_CHANNEL_PREFIX,
	CLIQ_STAFF_EMAILS,
	CLIQ_INVITE_CLIENT_EMAILS
} from '$env/static/private';
import type { RequestHandler } from './$types';

const parseEmailList = (value: string | undefined) =>
	(value || '')
		.split(',')
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

const toSlug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);

const getConversationId = (payload: any) =>
	payload?.entity_id ||
	payload?.conversation_id ||
	payload?.conversation?.id ||
	payload?.data?.id ||
	payload?.data?.conversation_id ||
	payload?.data?.conversation?.id ||
	payload?.id ||
	null;

const getVisitorEmail = (payload: any) =>
	payload?.visitor?.email_id ||
	payload?.visitor?.email ||
	payload?.data?.visitor?.email_id ||
	payload?.data?.visitor?.email ||
	payload?.data?.email ||
	payload?.email ||
	null;

const getMessageText = (payload: any) =>
	payload?.message?.text ||
	payload?.message?.content?.text ||
	payload?.data?.message?.text ||
	payload?.data?.message?.content?.text ||
	payload?.data?.question ||
	payload?.question ||
	null;

const getEventName = (payload: any) =>
	payload?.event ||
	payload?.data?.event ||
	payload?.data?.event_type ||
	payload?.event_type ||
	payload?.type ||
	'conversation.event';

const toSafeIso = (value: unknown) => {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	return new Date().toISOString();
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) {
		throw error(400, 'Invalid payload');
	}

	const eventName = getEventName(body);
	const conversationId = getConversationId(body);
	const visitorEmail = getVisitorEmail(body);
	const messageText = getMessageText(body);

	if (!conversationId || !visitorEmail) {
		console.warn('SalesIQ webhook missing conversation or visitor', { eventName, conversationId, visitorEmail });
		return json({ ok: true });
	}

	const client = await getClientByEmail(visitorEmail);
	if (!client) {
		console.warn('SalesIQ webhook client not found', { visitorEmail, conversationId });
		return json({ ok: true });
	}

	const cliqTokens = await getCliqTokens();
	if (!cliqTokens) {
		console.error('SalesIQ webhook missing OAuth tokens');
		return json({ ok: false, reason: 'missing_tokens' }, { status: 500 });
	}

	let cliqAccessToken = cliqTokens.access_token;
	if (new Date(cliqTokens.expires_at) < new Date()) {
		const refreshed = await refreshCliqAccessToken(cliqTokens.refresh_token);
		cliqAccessToken = refreshed.access_token;
		await upsertCliqTokens({
			user_id: cliqTokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: cliqTokens.scope
		});
	}

	let channel = await getClientCliqChannel(client.id);
	if (!channel) {
		const prefix = CLIQ_CHANNEL_PREFIX || 'client';
		const label = toSlug(client.full_name || client.email || client.id);
		const channelName = `${prefix}-${label}-${client.id.slice(0, 6)}`;
		const staffEmails = parseEmailList(CLIQ_STAFF_EMAILS);
		const inviteClient = (CLIQ_INVITE_CLIENT_EMAILS || 'true').toLowerCase() !== 'false';
		const emailIds = inviteClient ? [...staffEmails, client.email] : staffEmails;

		try {
			const payload: {
				name: string;
				description: string;
				level: 'external' | 'organization';
				invite_only: boolean;
				email_ids?: string[];
			} = {
				name: channelName,
				description: `Client channel for ${client.full_name || client.email}`,
				level: inviteClient ? 'external' : 'organization',
				invite_only: true
			};

			if (emailIds.length > 0) {
				payload.email_ids = emailIds;
			}

			const created = await createCliqChannel(cliqAccessToken, payload);

			const channelData = created?.channel || created?.data || created;
			const channelId =
				channelData?.id || channelData?.channel_id || channelData?.resource?.id || channelData?.data?.id;
			const resolvedName = channelData?.unique_name || channelData?.name || channelName;

			if (!channelId) {
				throw new Error('Cliq channel id missing from response');
			}

			channel = await upsertClientCliqChannel({
				client_id: client.id,
				cliq_channel_id: channelId,
				cliq_channel_name: resolvedName
			});
		} catch (err) {
			console.warn('Cliq channel creation failed, attempting lookup', err);
			try {
				const found = await findCliqChannelByName(cliqAccessToken, channelName);
				const channelData = found?.channels?.[0] || found?.data?.[0] || found?.channels || found?.data;
				const channelId = channelData?.id || channelData?.channel_id;
				const resolvedName = channelData?.unique_name || channelData?.name || channelName;
				if (!channelId) throw new Error('Cliq channel lookup failed');
				channel = await upsertClientCliqChannel({
					client_id: client.id,
					cliq_channel_id: channelId,
					cliq_channel_name: resolvedName
				});
			} catch (lookupErr) {
				console.error('Cliq channel lookup failed', lookupErr);
				return json({ ok: false }, { status: 500 });
			}
		}
	}

	const displayName =
		client.full_name ||
		[client.first_name, client.last_name].filter(Boolean).join(' ') ||
		client.email;
	const header = `SalesIQ ${eventName} — ${displayName} (${client.email})`;
	const bodyText = messageText ? `Message: ${messageText}` : `Conversation ${conversationId}`;
	const outbound = `${header}\n${bodyText}`;

	await postCliqChannelMessage(cliqAccessToken, channel.cliq_channel_id, outbound);

	await upsertSalesiqConversation({
		conversation_id: conversationId,
		client_id: client.id,
		cliq_channel_id: channel.cliq_channel_id,
		last_event_time: toSafeIso(body?.event_time || body?.time || body?.timestamp || Date.now()),
		last_visitor_message: messageText
	});

	return json({ ok: true });
};

export const HEAD: RequestHandler = async () => {
	return new Response(null, { status: 200 });
};
