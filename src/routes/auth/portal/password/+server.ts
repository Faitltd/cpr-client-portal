import { json } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { dev } from '$app/environment';
import { PORTAL_ADMIN_PASSWORD } from '$env/static/private';
import {
	createSession,
	createTradeSession,
	getClientAuthByEmail,
	getTradePartnerAuthByEmail
} from '$lib/server/db';
import {
	createAdminSession,
	getAdminSessionMaxAge,
	isAdminConfigured
} from '$lib/server/admin';
import { verifyPassword } from '$lib/server/password';
import type { RequestHandler } from './$types';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const body = await request.json().catch(() => ({}));
	const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
	const password = typeof body.password === 'string' ? body.password : '';

	if (!password) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	const adminConfigured = isAdminConfigured();
	if (
		adminConfigured &&
		PORTAL_ADMIN_PASSWORD &&
		password === PORTAL_ADMIN_PASSWORD &&
		(!email || email === 'admin')
	) {
		const session = createAdminSession();
		cookies.set('admin_session', session, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: getAdminSessionMaxAge()
		});
		return json({ message: 'Login successful.', redirect: '/admin/clients', role: 'admin' });
	}

	if (!email) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	const client = await getClientAuthByEmail(email);
	if (client && verifyPassword(password, client.password_hash)) {
		if (!client.portal_active) {
			return json({ message: 'Your portal access is not active yet.' }, { status: 403 });
		}

		const sessionId = createHash('sha256')
			.update(`${client.id}:${Date.now()}:${Math.random()}`)
			.digest('hex');
		const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
		const ipAddress = getClientAddress ? getClientAddress() : null;

		await createSession({
			session_token: sessionId,
			client_id: client.id,
			expires_at: sessionExpiresAt,
			ip_address: ipAddress,
			user_agent: request.headers.get('user-agent')
		});

		cookies.set('portal_session', sessionId, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 7
		});

		return json({ message: 'Login successful.', redirect: '/dashboard', role: 'client' });
	}

	const tradePartner = await getTradePartnerAuthByEmail(email);
	if (tradePartner && verifyPassword(password, tradePartner.password_hash)) {
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

		return json({ message: 'Login successful.', redirect: '/trade/dashboard', role: 'trade' });
	}

	return json({ message: 'Invalid email or password.' }, { status: 401 });
};
