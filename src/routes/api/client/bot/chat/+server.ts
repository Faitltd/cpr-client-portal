import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { runChat, type ChatMessage } from '$lib/server/bot/chat';
import { getDealsForClient } from '$lib/server/projects';
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
	if (!access || access.role !== 'client') {
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

	// Enforce that the client owns this Deal.
	if (!access.clientId) {
		return json({ message: 'Client session missing id' }, { status: 401 });
	}
	const allowed = await getDealsForClient(access.clientId).catch(() => [] as any[]);
	const allowedIds = new Set(
		(allowed ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
	);
	if (!allowedIds.has(dealId)) {
		return json({ message: 'You do not have access to this Deal' }, { status: 403 });
	}

	try {
		const stream = await runChat({
			dealId,
			threadId,
			adminEmail: access.email || 'client',
			messages,
			allowedSources: access.allowedSources,
			allowedTopFolders: access.allowedTopFolders,
			hideFinancials: access.hideFinancials,
			hideInternalFinancials: access.hideInternalFinancials
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
