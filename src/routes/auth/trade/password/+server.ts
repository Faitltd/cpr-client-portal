import { json } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { dev } from '$app/environment';
import { createTradeSession, getTradePartnerAuthByEmail } from '$lib/server/db';
import { verifyPassword } from '$lib/server/password';
import type { RequestHandler } from './$types';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const body = await request.json().catch(() => ({}));
	const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
	const password = typeof body.password === 'string' ? body.password : '';

	if (!email || !password) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	const tradePartner = await getTradePartnerAuthByEmail(email);
	if (!tradePartner || !verifyPassword(password, tradePartner.password_hash)) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	const sessionId = createHash('sha256')
		.update(`${tradePartner.id}:${Date.now()}:${Math.random()}`)
		.digest('hex');
	const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
	const ipAddress = getClientAddress ? getClientAddress() : null;

	await createTradeSession({
		session_token: sessionId,
		trade_partner_id: tradePartner.id,
		expires_at: sessionExpiresAt,
		ip_address: ipAddress,
		user_agent: request.headers.get('user-agent')
	});

	cookies.set('trade_session', sessionId, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 7
	});

	return json({ message: 'Login successful.' });
};
