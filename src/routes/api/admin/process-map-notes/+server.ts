import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getAllProcessMapNotes, upsertProcessMapNote } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const notes = await getAllProcessMapNotes();
		return json({ data: notes });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch notes';
		return json({ message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const { stepCode, note } = body ?? {};
	if (typeof stepCode !== 'string' || !stepCode) {
		return json({ message: 'stepCode is required' }, { status: 400 });
	}

	try {
		await upsertProcessMapNote(stepCode, typeof note === 'string' ? note : '');
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to save note';
		return json({ message }, { status: 500 });
	}
};
