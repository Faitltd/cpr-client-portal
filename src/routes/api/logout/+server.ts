import { redirect } from '@sveltejs/kit';
import { deleteSession, deleteTradeSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const handleLogout: RequestHandler = async ({ cookies, url }) => {
	const sessionId = cookies.get('portal_session');
	const tradeSessionId = cookies.get('trade_session');

	if (sessionId) {
		// Delete session from database
		await deleteSession(sessionId);
	}
	if (tradeSessionId) {
		await deleteTradeSession(tradeSessionId);
	}

	// Clear session cookie
	cookies.delete('portal_session', { path: '/' });
	cookies.delete('trade_session', { path: '/' });

	const next = url.searchParams.get('next') || '/';
	throw redirect(303, next);
};

export const POST = handleLogout;
export const GET = handleLogout;
