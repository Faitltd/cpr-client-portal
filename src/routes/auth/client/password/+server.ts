import { json, redirect } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { dev } from '$app/environment';
import { createSession, getClientAuthByEmail } from '$lib/server/db';
import { verifyClientPasswordInput } from '$lib/server/client-password';
import type { RequestHandler } from './$types';

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

	if (!email || !password) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/client?error=invalid');
	}

	const client = await getClientAuthByEmail(email);
	if (!client || !verifyClientPasswordInput(password, client.password_hash)) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/client?error=invalid');
	}
	if (!client.portal_active) {
		if (expectsJson) {
			return json({ message: 'Your portal access is not active yet.' }, { status: 403 });
		}
		throw redirect(303, '/auth/client?error=inactive');
	}

	const sessionId = createHash('sha256').update(`${client.id}:${Date.now()}:${Math.random()}`).digest('hex');
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

	if (expectsJson) {
		return json({ message: 'Login successful.' });
	}

	throw redirect(303, '/dashboard');
};
