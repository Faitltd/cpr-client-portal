import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { runMasterChatNonStreaming, type ChatMessage } from '$lib/server/bot/chat';
import type { RequestHandler } from './$types';

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
	// Master bot sees every deal + full financials — admins only.
	if (!access || access.role !== 'admin') {
		return json({ message: 'Admin access required' }, { status: 403 });
	}

	let body: { messages?: ChatMessage[] };
	try {
		body = (await request.json()) as { messages?: ChatMessage[] };
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const messages = Array.isArray(body.messages) ? body.messages.filter(isMessage) : [];
	if (messages.length === 0) return json({ message: 'messages required' }, { status: 400 });
	if (messages.at(-1)!.role !== 'user') {
		return json({ message: 'Last message must be from user' }, { status: 400 });
	}

	try {
		const reply = await runMasterChatNonStreaming({ adminEmail: access.email, messages });
		return json({ reply });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Chat failed';
		return json({ message }, { status: 500 });
	}
};
