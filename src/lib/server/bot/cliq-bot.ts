import { env } from '$env/dynamic/private';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { postCliqChatViaRest } from '$lib/server/cliq';
import type { CliqMessage } from '$lib/server/cliq';

const CLIQ_API_BASE = (env.ZOHO_CLIQ_API_BASE || 'https://cliq.zoho.com/api/v2').replace(/\/$/, '');

/**
 * Bot's own user id — used to suppress self-triggered loops when the
 * Participation Handler fires on our own posts. Set in env.
 */
const BOT_USER_ID = (env.ZOHO_CLIQ_BOT_USER_ID ?? '').trim();

/**
 * Look up which Deal a Cliq internal channel id belongs to.
 *
 * Each Deal stores its internal Cliq channel in `Cliq_Internal_Channel_ID`.
 * We search the Deals module for an exact match.
 */
export interface ChannelDealMatch {
	dealId: string;
	dealName: string;
	stage: string;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
}

export async function findDealByCliqChannelId(
	chatId: string
): Promise<ChannelDealMatch | null> {
	if (!chatId) return null;
	const { accessToken, apiDomain } = await getValidAccessToken();
	const criteria = encodeURIComponent(`(Cliq_Internal_Channel_ID:equals:${chatId})`);
	const fields = 'Deal_Name,Stage,Cliq_Internal_Channel_ID';
	try {
		const res = await zohoApiCall(
			accessToken,
			`/Deals/search?criteria=${criteria}&fields=${fields}&per_page=5`,
			{},
			apiDomain
		);
		const items: any[] = Array.isArray(res?.data) ? res.data : [];
		if (items.length === 0) return null;
		const d = items[0];
		return {
			dealId: String(d.id),
			dealName: String(d.Deal_Name ?? ''),
			stage: String(d.Stage ?? '')
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// The Cliq_Internal_Channel_ID field is not always searchable in CRM —
		// silently fall back to shared-channel name parsing when that happens.
		if (!/not available for search/i.test(msg)) {
			console.warn('[cliq-bot] channel→deal lookup failed:', msg);
		}
		return null;
	}
}

/**
 * Shared-channel mode: when the bot lives in a single dedicated channel,
 * messages identify the Deal by name fragment ("stephen blume: <question>").
 * Search Deals where Deal_Name contains the fragment.
 */
export async function findDealsByNameFragment(
	fragment: string,
	limit = 5
): Promise<ChannelDealMatch[]> {
	const trimmed = fragment.trim();
	if (!trimmed) return [];
	const { accessToken, apiDomain } = await getValidAccessToken();
	const fields = 'Deal_Name,Stage';
	const lowerFragment = trimmed.toLowerCase();

	// Try Zoho's full-text `word` search first — more reliable than `contains`
	// criteria on Deal_Name. Then filter the response client-side because the
	// `word` search also matches against Contact_Name, Account_Name, etc.
	try {
		const res = await zohoApiCall(
			accessToken,
			`/Deals/search?word=${encodeURIComponent(trimmed)}&fields=${fields}&per_page=${Math.max(
				limit,
				20
			)}`,
			{},
			apiDomain
		);
		const items: any[] = Array.isArray(res?.data) ? res.data : [];
		const matches = items
			.filter((d) => {
				const name = String(d.Deal_Name ?? '').toLowerCase();
				return name.includes(lowerFragment);
			})
			.slice(0, limit)
			.map((d) => ({
				dealId: String(d.id),
				dealName: String(d.Deal_Name ?? ''),
				stage: String(d.Stage ?? '')
			}));
		if (matches.length > 0) return matches;
	} catch (err) {
		console.warn(
			'[cliq-bot] word search failed:',
			err instanceof Error ? err.message : err
		);
	}

	// Fallback: starts_with (works for Deal names that begin with the fragment,
	// e.g. "Stephen" matches "Stephen Blume - 02/01/2026")
	try {
		const criteria = encodeURIComponent(`(Deal_Name:starts_with:${trimmed})`);
		const res = await zohoApiCall(
			accessToken,
			`/Deals/search?criteria=${criteria}&fields=${fields}&per_page=${limit}`,
			{},
			apiDomain
		);
		const items: any[] = Array.isArray(res?.data) ? res.data : [];
		return items.slice(0, limit).map((d) => ({
			dealId: String(d.id),
			dealName: String(d.Deal_Name ?? ''),
			stage: String(d.Stage ?? '')
		}));
	} catch (err) {
		console.warn(
			'[cliq-bot] starts_with fallback failed:',
			err instanceof Error ? err.message : err
		);
		return [];
	}
}

/**
 * Post a bot reply back to the Cliq channel. Uses the primary OAuth token —
 * the bot's reply is attributed to whichever user authorized us (typically
 * Ray). For a proper "bot identity" you can attach a bot avatar/name via the
 * message.bot field.
 */
export async function postCliqBotMessage(chatId: string, message: CliqMessage): Promise<void> {
	const { accessToken } = await getValidAccessToken();
	const res = await postCliqChatViaRest(accessToken, chatId, message);
	if (!res.ok) {
		console.warn('[cliq-bot] reply post failed:', res.error);
	}
}

/**
 * Fetch the most recent message in a Cliq chat. Used by the auto-respond
 * (Participation Handler) flow, where Cliq's handler doesn't pass us the
 * message text directly.
 *
 * Returns { text, sender_id } or null if nothing is fetchable.
 */
export async function fetchLatestChatMessage(
	chatId: string
): Promise<{ text: string; senderId: string | null } | null> {
	if (!chatId) return null;
	const { accessToken } = await getValidAccessToken();
	const url = `${CLIQ_API_BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=1`;
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
		});
		if (!res.ok) {
			console.warn('[cliq-bot] fetch latest message HTTP', res.status);
			return null;
		}
		const body = await res.json().catch(() => null);
		const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
		const first = items[0];
		if (!first) return null;
		const text =
			(typeof first?.content?.text === 'string' && first.content.text) ||
			(typeof first?.text === 'string' && first.text) ||
			'';
		const senderId = first?.sender?.id ?? first?.sender_id ?? null;
		return { text, senderId: senderId ? String(senderId) : null };
	} catch (err) {
		console.warn(
			'[cliq-bot] fetch latest message failed:',
			err instanceof Error ? err.message : err
		);
		return null;
	}
}

export function isBotSenderId(senderId: string | null): boolean {
	if (!senderId || !BOT_USER_ID) return false;
	return senderId === BOT_USER_ID;
}

/**
 * Strip the `@CRMBot` mention (or whatever the bot is called) from the start
 * of the message so the question we send to the LLM is clean.
 */
export function stripBotMention(text: string, botName?: string): string {
	const name = (botName ?? env.ZOHO_CLIQ_BOT_NAME ?? '').trim();
	let out = text.trim();
	if (name) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		out = out.replace(new RegExp(`^@?${escaped}[:,\\s]+`, 'i'), '');
	}
	// Also strip generic leading @mention if Cliq includes one (e.g. @CRMBot)
	out = out.replace(/^@\S+[:,\s]+/, '');
	return out.trim();
}
