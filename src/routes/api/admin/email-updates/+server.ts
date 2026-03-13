import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const [prefsResult, sentResult] = await Promise.all([
			supabase
				.from('email_preferences')
				.select('*')
				.order('updated_at', { ascending: false }),
			supabase
				.from('sent_emails')
				.select('*')
				.order('created_at', { ascending: false })
				.limit(50)
		]);

		if (prefsResult.error) throw new Error(prefsResult.error.message);
		if (sentResult.error) throw new Error(sentResult.error.message);

		return json({
			data: {
				preferences: prefsResult.data || [],
				sent_emails: sentResult.data || []
			}
		});
	} catch (err) {
		console.error('GET /api/admin/email-updates error:', err);
		const error = err instanceof Error ? err.message : 'Failed to load email data';
		return json({ error }, { status: 500 });
	}
};
