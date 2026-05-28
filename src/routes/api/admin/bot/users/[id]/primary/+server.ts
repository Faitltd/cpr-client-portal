import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { setPrimaryZohoToken } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, params }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	const id = params.id;
	if (!id) return json({ message: 'id required' }, { status: 400 });
	try {
		await setPrimaryZohoToken(id);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'promote failed';
		return json({ ok: false, message }, { status: 500 });
	}
};
