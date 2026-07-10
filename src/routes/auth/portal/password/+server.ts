import { json, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { generateSessionToken } from '$lib/server/session-token';
import { env } from '$env/dynamic/private';
import { normalizeEmailAddress } from '$lib/server/auth-normalization';
import {
	createDesignerSession,
	createSession,
	createTradeSession,
	getAdminUserAuthByEmail,
	getClientAuthByEmail,
	getDesignerAuthByEmail,
	getTradePartnerAuthByEmail
} from '$lib/server/db';
import { reconcileClientPhoneLogin } from '$lib/server/client-login';
import { verifyClientPasswordInput } from '$lib/server/client-password';
import { verifyTradePartnerLogin } from '$lib/server/trade-login';
import {
	createAdminSession,
	getAdminSessionMaxAge,
	isAdminConfigured
} from '$lib/server/admin';
import { seedPortalSessionsForAdmin } from '$lib/server/admin-portal-session';
import { staffLandingFor } from '$lib/server/designer';
import { normalizeStaffRole } from '$lib/server/db';
import { verifyPassword } from '$lib/server/password';
import { checkLoginRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

const PORTAL_ADMIN_PASSWORD = env.PORTAL_ADMIN_PASSWORD || '';
const PORTAL_ADMIN_EMAIL = normalizeEmailAddress(env.PORTAL_ADMIN_EMAIL || 'ray@homecpr.pro');
// Same admin email set as /admin/login: plural env first, then singular, then default.
const PORTAL_ADMIN_EMAILS_SET = new Set(
	(env.PORTAL_ADMIN_EMAILS || env.PORTAL_ADMIN_EMAIL || 'ray@homecpr.pro')
		.split(',')
		.map((value) => normalizeEmailAddress(value))
		.filter(Boolean)
);

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

	if (!password) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/portal?error=invalid');
	}

	const rateLimit = checkLoginRateLimit(email || 'no-email', getClientAddress ? getClientAddress() : null);
	if (!rateLimit.allowed) {
		if (expectsJson) {
			return json(
				{ message: 'Too many login attempts. Please try again later.' },
				{ status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
			);
		}
		throw redirect(303, '/auth/portal?error=rate_limited');
	}

	// ── Admin check (highest priority) ──────────────────────────────────
	// Checked before other roles so admin is never shadowed by them.
	// Path 1 — env admin: an allowed email (or no email) + the shared
	// PORTAL_ADMIN_PASSWORD.
	// Path 2 — per-user admin: an active admin_users row with its own hashed
	// password (same as /admin/login).
	const adminConfigured = isAdminConfigured();
	let isAdminLogin = false;
	if (adminConfigured && PORTAL_ADMIN_PASSWORD) {
		const isAdminEmail = email === PORTAL_ADMIN_EMAIL || PORTAL_ADMIN_EMAILS_SET.has(email);
		const isNoEmail = !email;
		isAdminLogin = (isAdminEmail || isNoEmail) && password === PORTAL_ADMIN_PASSWORD;
	}
	if (!isAdminLogin && adminConfigured && email) {
		try {
			const adminUser = await getAdminUserAuthByEmail(email);
			isAdminLogin =
				!!adminUser &&
				adminUser.active !== false &&
				(await verifyPassword(password, adminUser.password_hash));
		} catch (err) {
			console.error('[portal-login] admin_users lookup failed', err);
		}
	}
	if (isAdminLogin) {
		const session = createAdminSession();
		cookies.set('admin_session', session, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: getAdminSessionMaxAge()
		});
		// Seed designer + trade sessions so the admin gets the full designer
		// dashboard (same tabs as designers) with the admin tabs added.
		const seeded = await seedPortalSessionsForAdmin(
			cookies,
			email || PORTAL_ADMIN_EMAIL,
			getClientAddress ? getClientAddress() : null,
			request.headers.get('user-agent')
		);
		const adminLanding = seeded ? '/designer' : '/admin';
		if (expectsJson) {
			return json({ message: 'Login successful.', redirect: adminLanding, role: 'admin' });
		}
		throw redirect(303, adminLanding);
	}

	if (!email) {
		if (expectsJson) {
			return json({ message: 'Invalid email or password.' }, { status: 401 });
		}
		throw redirect(303, '/auth/portal?error=invalid');
	}

	// ── Designer check (before client) ──────────────────────────────────
	// Internal staff accounts take precedence over the client path. The client
	// path runs phone-based reconciliation that can auto-create a client record
	// from a matching Zoho contact (email + phone-as-password). A designer whose
	// password happens to match their contact phone would otherwise be logged in
	// as a client. Checking designer first keeps internal users in the designer
	// portal.
	const designer = await getDesignerAuthByEmail(email);
	if (
		designer &&
		designer.active !== false &&
		(await verifyPassword(password, designer.password_hash))
	) {
		const sessionId = generateSessionToken();
		const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
		const ipAddress = getClientAddress ? getClientAddress() : null;

		await createDesignerSession({
			session_token: sessionId,
			designer_id: designer.id,
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

		// Dual-role: a designer who is also a trade partner gets a trade_session
		// too, so the embedded Field Dashboard / Field Update tabs authenticate.
		// Landing depends on staff role: finance goes to the Finance dashboard,
		// designer and ops land on the CRM tab (/designer).
		const designerLanding = staffLandingFor(normalizeStaffRole(designer.role));
		const tradePartnerForDesigner = await getTradePartnerAuthByEmail(email);
		if (tradePartnerForDesigner) {
			const tradeSessionId = generateSessionToken();
			await createTradeSession({
				session_token: tradeSessionId,
				trade_partner_id: tradePartnerForDesigner.id,
				expires_at: sessionExpiresAt,
				ip_address: ipAddress,
				user_agent: request.headers.get('user-agent')
			});
			cookies.set('trade_session', tradeSessionId, {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'strict',
				maxAge: 60 * 60 * 24 * 7
			});
		}

		if (expectsJson) {
			return json({ message: 'Login successful.', redirect: designerLanding, role: 'designer' });
		}
		throw redirect(303, designerLanding);
	}

	// ── Client check ────────────────────────────────────────────────────
	const client = await getClientAuthByEmail(email);
	const clientPasswordValid = client
		? await verifyClientPasswordInput(password, client.password_hash)
		: false;
	const repairedClient = !client || !clientPasswordValid ? await reconcileClientPhoneLogin(email, password) : null;
	const effectiveClientId = repairedClient?.id || client?.id || '';

	if (effectiveClientId && (clientPasswordValid || repairedClient)) {
		const sessionId = generateSessionToken();
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

	// ── Trade partner check ─────────────────────────────────────────────
	const tradePartner = await getTradePartnerAuthByEmail(email);
	if (tradePartner && (await verifyTradePartnerLogin(tradePartner, password))) {
		const sessionId = generateSessionToken();
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

	if (expectsJson) {
		return json({ message: 'Invalid email or password.' }, { status: 401 });
	}

	throw redirect(303, '/auth/portal?error=invalid');
};
