import { json, redirect } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	createSession,
	createTradeSession,
	getClientAuthByEmail,
	getTradePartnerAuthByEmail
} from '$lib/server/db';
import { reconcileClientPhoneLogin } from '$lib/server/client-login';
import { verifyClientPasswordInput } from '$lib/server/client-password';
import {
	createAdminSession,
	getAdminSessionMaxAge,
	isAdminConfigured
} from '$lib/server/admin';
import { verifyPassword } from '$lib/server/password';
import type { RequestHandler } from './$types';

const PORTAL_ADMIN_PASSWORD = env.PORTAL_ADMIN_PASSWORD || '';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isJsonRequest = (request: Request) =>
	request.headers.get('content-type')?.includes('application/json') ?? false;

const getFormValue = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === 'string' ? value : '';
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const expectsJson = isJsonRequest(request);
	const credentials = expectsJson
		? await request.json().catch(() => ({}))
		: await request.formData();
	const email = normalizeEmail(
		expectsJson
			? typeof credentials.email === 'string'
				? credentials.email
				: ''
			: getFormValue(credentials, 'email')
	);
	const password = expectsJson
		? typeof credentials.password === 'string'
			? credentials.password
			: ''
		: getFormValue(credentials, 'password');

	if (!password) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/portal?error=invalid');
	}

	if (!email) {
		const adminConfigured = isAdminConfigured();
		if (adminConfigured && PORTAL_ADMIN_PASSWORD && password === PORTAL_ADMIN_PASSWORD) {
			const session = createAdminSession();
			cookies.set('admin_session', session, {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'strict',
				maxAge: getAdminSessionMaxAge()
			});
			if (expectsJson) {
				return json({ message: 'Login successful.', redirect: '/admin', role: 'admin' });
			}
			throw redirect(303, '/admin');
		}
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/portal?error=invalid');
	}

	const client = await getClientAuthByEmail(email);
	const clientPasswordValid = client ? verifyClientPasswordInput(password, client.password_hash) : false;
	const repairedClient = !client || !clientPasswordValid ? await reconcileClientPhoneLogin(email, password) : null;
	const effectiveClientId = repairedClient?.id || client?.id || '';

	if (effectiveClientId && (clientPasswordValid || repairedClient)) {
		const sessionId = createHash('sha256')
			.update(`${effectiveClientId}:${Date.now()}:${Math.random()}`)
			.digest('hex');
		const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
		const ipAddress = getClientAddress ? getClientAddress() : null;

		await createSession({
			session_token: sessionId,
			client_id: effectiveClientId,
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

		if (expectsJson) {
			return json({ message: 'Login successful.', redirect: '/dashboard', role: 'client' });
		}
		throw redirect(303, '/dashboard');
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

		if (expectsJson) {
			return json({ message: 'Login successful.', redirect: '/trade/dashboard', role: 'trade' });
		}
		throw redirect(303, '/trade/dashboard');
	}

	const adminConfigured = isAdminConfigured();
	if (adminConfigured && PORTAL_ADMIN_PASSWORD && password === PORTAL_ADMIN_PASSWORD) {
		const session = createAdminSession();
		cookies.set('admin_session', session, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: getAdminSessionMaxAge()
		});
		if (expectsJson) {
			return json({ message: 'Login successful.', redirect: '/admin', role: 'admin' });
		}
		throw redirect(303, '/admin');
	}

	if (expectsJson) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	throw redirect(303, '/auth/portal?error=invalid');
};
