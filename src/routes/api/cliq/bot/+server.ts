import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runChatNonStreaming } from '$lib/server/bot/chat';
import {
	fetchLatestChatMessage,
	findDealByCliqChannelId,
	findDealsByNameFragment,
	isBotSender,
	postCliqBotMessage,
	stripBotMention,
	type ChannelDealMatch
} from '$lib/server/bot/cliq-bot';
import type { RequestHandler } from './$types';

const BOT_TOKEN = env.ZOHO_CLIQ_BOT_TOKEN ?? '';

/**
 * Pull whichever shape Cliq actually sends. Cliq's bot handler payload varies
 * slightly between message/mention/command — we try the common locations.
 */
function extractText(body: any): string {
	if (typeof body?.message === 'string') return body.message;
	if (typeof body?.text === 'string') return body.text;
	if (typeof body?.content?.text === 'string') return body.content.text;
	return '';
}

function extractChatId(body: any): string {
	const candidates: Array<unknown> = [
		body?.chat?.id,
		body?.chat_id,
		body?.channel?.id,
		body?.channel_id,
		body?.thread?.chat_id
	];
	for (const c of candidates) {
		if (typeof c === 'string' && c.trim()) return c.trim();
	}
	return '';
}

function extractUser(body: any): { id: string; email: string; name: string } {
	const user = body?.user ?? body?.sender ?? body?.from ?? {};
	return {
		id: String(user.id ?? user.user_id ?? ''),
		email: String(user.email ?? user.email_id ?? ''),
		name: String(user.name ?? body?.name ?? '')
	};
}

/**
 * POST /api/cliq/bot
 * Zoho Cliq calls this when the bot is @mentioned in a channel. We resolve the
 * channel id to a Deal, run the chat asynchronously, then post the answer back
 * via Cliq's REST API. The webhook itself returns immediately so Cliq doesn't
 * time out (chat can take 5–15s).
 */
export const POST: RequestHandler = async ({ request }) => {
	// Token check — Cliq lets you set a custom header on bot webhooks.
	if (BOT_TOKEN) {
		const provided =
			request.headers.get('x-cliq-bot-token') ??
			request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
			'';
		if (provided !== BOT_TOKEN) {
			return json({ text: 'Unauthorized.' }, { status: 401 });
		}
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ text: 'Bad request: invalid JSON.' }, { status: 400 });
	}

	const chatId = extractChatId(body);
	let rawText = extractText(body);
	const user = extractUser(body);

	// Auto-respond mode: when the Participation Handler triggers, Cliq doesn't
	// pass us the message text. Fetch it from the chat's history.
	if (!rawText && chatId) {
		const latest = await fetchLatestChatMessage(chatId);
		if (latest) {
			if (isBotSender(latest.sender)) {
				// Self-triggered — ignore to avoid infinite loops.
				return json({});
			}
			rawText = latest.text;
		}
	}

	const question = stripBotMention(rawText);

	console.log(
		`[cliq-bot] chat=${chatId} user=${user.email || user.id} q="${question.slice(0, 80)}"`
	);

	if (!chatId) {
		return json({ text: 'No chat id in request payload.' });
	}
	if (!question) {
		// Either no text fetched, or the message was bot-only — stay silent.
		return json({});
	}

	// Resolve channel → Deal (per-Deal internal channel mode)
	let match: ChannelDealMatch | null = await findDealByCliqChannelId(chatId);
	let askText = question;

	// Shared-channel mode: when no channel→Deal mapping exists, expect the
	// message to be formatted as `<deal name fragment>: <question>`.
	if (!match) {
		const colon = question.indexOf(':');
		if (colon === -1) {
			// Not addressed to the bot in shared-channel form — stay silent so
			// we don't spam unrelated messages.
			return json({});
		}
		const namePart = question.slice(0, colon).trim();
		const questionPart = question.slice(colon + 1).trim();
		if (!namePart || !questionPart) {
			return json({
				text: 'Format: `<deal name>: <question>` — e.g. `Stephen Blume: what is the address?`'
			});
		}

		const matches = await findDealsByNameFragment(namePart);
		if (matches.length === 0) {
			return json({ text: `No Deal name matched "${namePart}".` });
		}
		if (matches.length > 1) {
			const list = matches.map((m) => `• ${m.dealName} (${m.stage})`).join('\n');
			return json({
				text: `Multiple Deals matched "${namePart}":\n${list}\n\nBe more specific.`
			});
		}
		match = matches[0];
		askText = questionPart;
	}

	// Synchronous reply — Cliq's Deluge `invokeurl` can wait up to ~2 minutes,
	// and our chat completes in ~10s. Doing this synchronously avoids the
	// scope-error mess of posting back via OAuth.
	try {
		const reply = await runChatNonStreaming({
			dealId: match.dealId,
			threadId: `cliq:${chatId}`,
			adminEmail: user.email || 'cliq-bot',
			messages: [{ role: 'user', content: askText }]
		});
		return json({
			text: `*${match.dealName}*\n\n${reply || '(no response generated)'}`,
			bot: { name: env.ZOHO_CLIQ_BOT_NAME || 'CRMBot' }
		});
	} catch (err) {
		console.warn(
			'[cliq-bot] chat run failed:',
			err instanceof Error ? err.message : err
		);
		return json({
			text: `Bot error: ${err instanceof Error ? err.message : 'unknown'}`,
			bot: { name: env.ZOHO_CLIQ_BOT_NAME || 'CRMBot' }
		});
	}
};
