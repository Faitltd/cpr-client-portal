import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createAdminSession, getAdminSessionMaxAge, isAdminConfigured } from '$lib/server/admin';
import { isValidAdminSession } from '$lib/server/admin';
import { normalizeEmailAddress } from '$lib/server/auth-normalization';
import {
	createDesignerSession,
	createTradeSession,
	getAdminUserAuthByEmail,
	getDesignerAuthByEmail,
	getTradePartnerAuthByEmail
} from '$lib/server/db';
import { generateSessionToken } from '$lib/server/session-token';
import { verifyPassword } from '$lib/server/password';
import { checkLoginRateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const PORTAL_ADMIN_PASSWORD = env.PORTAL_ADMIN_PASSWORD || '';
// Allow one or more admin emails (comma-separated). Falls back to the single
// PORTAL_ADMIN_EMAIL, then to the original default. All share PORTAL_ADMIN_PASSWORD.
const PORTAL_ADMIN_EMAILS = new Set(
	(env.PORTAL_ADMIN_EMAILS || env.PORTAL_ADMIN_EMAIL || 'ray@homecpr.pro')
		.split(',')
		.map((value) => normalizeEmailAddress(value))
		.filter(Boolean)
);

export const load: PageServerLoad = async ({ cookies }) => {
	if (isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin');
	}

	return {
		isConfigured: isAdminConfigured()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		if (!isAdminConfigured()) {
			return fail(500, { message: 'Admin password not configured.' });
		}

		const form = await request.formData();
		const email = normalizeEmailAddress(String(form.get('email') || ''));
		const password = String(form.get('password') || '');

		if (!email || !password) {
			return fail(401, { message: 'Invalid email or password.' });
		}

		const rateLimit = checkLoginRateLimit(email, getClientAddress ? getClientAddress() : null);
		if (!rateLimit.allowed) {
			return fail(429, { message: 'Too many login attempts. Please try again later.' });
		}

		// Path 1 — env admin: an allowed email + the shared PORTAL_ADMIN_PASSWORD.
		const isEnvAdmin =
			PORTAL_ADMIN_EMAILS.has(email) &&
			Boolean(PORTAL_ADMIN_PASSWORD) &&
			password === PORTAL_ADMIN_PASSWORD;

		// Path 2 — per-user admin: a row in admin_users with its own hashed password.
		let isDbAdmin = false;
		if (!isEnvAdmin) {
			try {
				const adminUser = await getAdminUserAuthByEmail(email);
				isDbAdmin =
					!!adminUser &&
					adminUser.active !== false &&
					(await verifyPassword(password, adminUser.password_hash));
			} catch (err) {
				console.error('[admin-login] admin_users lookup failed', err);
			}
		}

		if (!isEnvAdmin && !isDbAdmin) {
			return fail(401, { message: 'Invalid email or password.' });
		}

		const session = createAdminSession();
		cookies.set('admin_session', session, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: getAdminSessionMaxAge()
		});

		// Seed designer + trade sessions for the admin's email so they land on
		// the full designer dashboard (same tabs as designers) with the admin
		// tabs added. Falls back to /admin if there's no designer account.
		let landing = '/admin';
		try {
			const designer = await getDesignerAuthByEmail(email);
			if (designer && designer.active !== false) {
				const sessionExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
				const ipAddress = getClientAddress ? getClientAddress() : null;
				const userAgent = request.headers.get('user-agent');

				const portalToken = generateSessionToken();
				await createDesignerSession({
					session_token: portalToken,
					designer_id: designer.id,
					expires_at: sessionExpiresAt,
					ip_address: ipAddress,
					user_agent: userAgent
				});
				cookies.set('portal_session', portalToken, {
					path: '/',
					httpOnly: true,
					secure: !dev,
					sameSite: 'strict',
					maxAge: 60 * 60 * 24 * 7
				});

				const tradePartner = await getTradePartnerAuthByEmail(email);
				if (tradePartner) {
					const tradeToken = generateSessionToken();
					await createTradeSession({
						session_token: tradeToken,
						trade_partner_id: tradePartner.id,
						expires_at: sessionExpiresAt,
						ip_address: ipAddress,
						user_agent: userAgent
					});
					cookies.set('trade_session', tradeToken, {
						path: '/',
						httpOnly: true,
						secure: !dev,
						sameSite: 'strict',
						maxAge: 60 * 60 * 24 * 7
					});
				}

				landing = '/designer';
			}
		} catch (err) {
			console.error('[admin-login] designer session seed failed', err);
		}

		throw redirect(302, landing);
	}
};
