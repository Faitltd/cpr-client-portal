import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { updateApprovalStatus } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const { status, responseNote } = body ?? {};
	if (!status) return json({ message: 'status required' }, { status: 400 });

	try {
		const data = await updateApprovalStatus(params.id, status, responseNote ?? undefined);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update approval';
		return json({ message }, { status: 500 });
	}
};
