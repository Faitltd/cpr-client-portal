import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { deleteZohoToken } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, params }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	const id = params.id;
	if (!id) return json({ message: 'id required' }, { status: 400 });
	try {
		await deleteZohoToken(id);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'delete failed';
		return json({ ok: false, message }, { status: 500 });
	}
};
