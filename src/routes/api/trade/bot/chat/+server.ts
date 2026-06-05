import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { runChat, type ChatMessage } from '$lib/server/bot/chat';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import type { RequestHandler } from './$types';

interface ChatRequestBody {
	dealId?: string;
	threadId?: string;
	messages?: ChatMessage[];
}

function isMessage(x: unknown): x is ChatMessage {
	if (!x || typeof x !== 'object') return false;
	const m = x as Record<string, unknown>;
	return (
		(m.role === 'user' || m.role === 'assistant') &&
		typeof m.content === 'string' &&
		m.content.length > 0
	);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const access = await getBotAccess(cookies);
	if (!access || (access.role !== 'trade_partner' && access.role !== 'admin')) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: ChatRequestBody;
	try {
		body = (await request.json()) as ChatRequestBody;
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const dealId = (body.dealId ?? '').trim();
	const threadId = (body.threadId ?? '').trim();
	const messages = Array.isArray(body.messages) ? body.messages.filter(isMessage) : [];
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });
	if (!threadId) return json({ message: 'threadId required' }, { status: 400 });
	if (messages.length === 0) return json({ message: 'messages required' }, { status: 400 });
	if (messages.at(-1)!.role !== 'user') {
		return json({ message: 'Last message must be from user' }, { status: 400 });
	}

	// Enforce per-deal access for trade partners. Admins skip this check
	// (admins can see any deal — useful for support / testing trade-partner view).
	if (access.role === 'trade_partner') {
		const tradeToken = cookies.get('trade_session') ?? '';
		const ctx = await loadTradePageContext(tradeToken, { includeDetailFields: false });
		if (ctx.redirectTo) {
			return json({ message: 'Trade session expired' }, { status: 401 });
		}
		const allowedDealIds = new Set(
			(ctx.deals ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
		);
		if (!allowedDealIds.has(dealId)) {
			return json({ message: 'You do not have access to this Deal' }, { status: 403 });
		}
	}

	// When admin opens the trade portal bot, force the SAME restrictions a
	// real trade partner would have so what they see matches production.
	// Otherwise admin's `allowedSources: null` leaks internal Cliq + Mail.
	const tradeLikeRestrictions = {
		allowedSources: [
			'workdrive_pdf',
			'workdrive_docx',
			'workdrive_xlsx',
			'zoho_crm_field',
			'zoho_cliq_external',
			'zoho_projects_task',
			'zoho_projects_activity',
			'zoho_sign_request'
		],
		allowedTopFolders: [
			'Designs',
			'Design',
			'Design & Planning',
			'Contracts and Agreements',
			'Contract and Agreement'
		],
		hideFinancials: true,
		hideInternalFinancials: false
	};
	const effective = access.role === 'admin' ? tradeLikeRestrictions : access;

	try {
		const stream = await runChat({
			dealId,
			threadId,
			adminEmail: access.email || 'trade_partner',
			messages,
			allowedSources: effective.allowedSources,
			allowedTopFolders: effective.allowedTopFolders,
			hideFinancials: effective.hideFinancials,
			hideInternalFinancials: effective.hideInternalFinancials
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no'
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Chat failed';
		return json({ message }, { status: 500 });
	}
};
