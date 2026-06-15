import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { syncConnecteamFeeds } from '$lib/server/connecteam';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Admin access required' }, { status: 403 });
	}
	try {
		const results = await syncConnecteamFeeds();
		const total = results.reduce((n, r) => n + r.shiftCount, 0);
		const errors = results.filter((r) => r.error).map((r) => r.error);
		return json({ ok: true, total, feeds: results.length, errors });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed';
		return json({ message }, { status: 500 });
	}
};
