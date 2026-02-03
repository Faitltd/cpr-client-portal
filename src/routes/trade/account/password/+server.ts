import { json, error } from '@sveltejs/kit';
import { getTradeSession, setTradePartnerPassword } from '$lib/server/db';
import { hashPassword } from '$lib/server/password';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		throw error(401, 'Invalid session');
	}

	const body = await request.json().catch(() => ({}));
	const password = typeof body.password === 'string' ? body.password : '';

	if (password.length < 8) {
		return json({ message: 'Password must be at least 8 characters.' }, { status: 400 });
	}

	const hash = hashPassword(password);
	await setTradePartnerPassword(session.trade_partner_id, hash);

	return json({ message: 'Password updated.' });
};
