import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get('portal_session');

	if (sessionId) {
		// Delete session from database
		await deleteSession(sessionId);
	}

	// Clear session cookie
	cookies.delete('portal_session', { path: '/' });

	throw redirect(302, '/');
};