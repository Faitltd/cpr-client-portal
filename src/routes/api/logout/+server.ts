import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const handleLogout: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get('portal_session');

	if (sessionId) {
		// Delete session from database
		await deleteSession(sessionId);
	}

	// Clear session cookie
	cookies.delete('portal_session', { path: '/' });

	throw redirect(302, '/');
};

export const POST = handleLogout;
export const GET = handleLogout;
