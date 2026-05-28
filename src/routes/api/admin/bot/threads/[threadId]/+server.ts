import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, params }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const threadId = params.threadId;
	if (!threadId) return json({ message: 'threadId required' }, { status: 400 });

	const { data: thread, error: threadErr } = await supabase
		.from('bot_threads')
		.select('id, deal_id, admin_email, title, created_at, last_message_at')
		.eq('id', threadId)
		.maybeSingle();

	if (threadErr) return json({ message: threadErr.message }, { status: 500 });
	if (!thread) return json({ message: 'Thread not found' }, { status: 404 });

	const { data: messages, error: msgErr } = await supabase
		.from('bot_messages')
		.select('id, role, content, created_at')
		.eq('thread_id', threadId)
		.order('created_at', { ascending: true });

	if (msgErr) return json({ message: msgErr.message }, { status: 500 });

	return json({ thread, messages: messages ?? [] });
};

export const DELETE: RequestHandler = async ({ cookies, params }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const threadId = params.threadId;
	if (!threadId) return json({ message: 'threadId required' }, { status: 400 });

	const { error } = await supabase.from('bot_threads').delete().eq('id', threadId);
	if (error) return json({ message: error.message }, { status: 500 });
	return json({ ok: true });
};
