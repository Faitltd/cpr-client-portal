import { json, redirect } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { dev } from '$app/environment';
import { createSession, getClientAuthByEmail } from '$lib/server/db';
import { normalizeEmailAddress } from '$lib/server/auth-normalization';
import { reconcileClientPhoneLogin } from '$lib/server/client-login';
import { verifyClientPasswordInput } from '$lib/server/client-password';
import type { RequestHandler } from './$types';

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
	const email = normalizeEmailAddress(
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
	const passwordValid = client
		? await verifyClientPasswordInput(password, client.password_hash)
		: false;
	const repairedClient = !client || !passwordValid ? await reconcileClientPhoneLogin(email, password) : null;
	const effectiveClientId = repairedClient?.id || client?.id || '';

	if (!effectiveClientId || (!passwordValid && !repairedClient)) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/client?error=invalid');
	}

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
		return json({ message: 'Login successful.' });
	}

	throw redirect(303, '/dashboard');
};
