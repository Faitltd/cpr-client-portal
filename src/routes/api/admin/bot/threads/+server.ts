import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const dealId = url.searchParams.get('dealId') ?? '';
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });

	const { data, error } = await supabase
		.from('bot_threads')
		.select('id, deal_id, admin_email, title, created_at, last_message_at')
		.eq('deal_id', dealId)
		.order('last_message_at', { ascending: false })
		.limit(50);

	if (error) return json({ message: error.message }, { status: 500 });
	return json({ data: data ?? [] });
};
