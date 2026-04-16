import { redirect } from '@sveltejs/kit';
import { deleteDesignerSession, deleteSession, deleteTradeSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const handleLogout: RequestHandler = async ({ cookies, url }) => {
	const sessionId = cookies.get('portal_session');
	const tradeSessionId = cookies.get('trade_session');

	if (sessionId) {
		// portal_session may map to either a client_sessions row or a designer_sessions row.
		// Try both — unmatched deletes are no-ops.
		await deleteSession(sessionId);
		await deleteDesignerSession(sessionId);
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
