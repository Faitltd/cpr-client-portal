import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createAdminSession, getAdminSessionMaxAge, isAdminConfigured } from '$lib/server/admin';
import { isValidAdminSession } from '$lib/server/admin';
import { normalizeEmailAddress } from '$lib/server/auth-normalization';
import { getAdminUserAuthByEmail } from '$lib/server/db';
import { seedPortalSessionsForAdmin } from '$lib/server/admin-portal-session';
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
	// Only skip the form when BOTH sessions exist — an admin session without a
	// portal session would strand the user on portal tabs that bounce to login.
	if (isValidAdminSession(cookies.get('admin_session')) && cookies.get('portal_session')) {
		throw redirect(302, '/designer');
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
		const seeded = await seedPortalSessionsForAdmin(
			cookies,
			email,
			getClientAddress ? getClientAddress() : null,
			request.headers.get('user-agent')
		);

		throw redirect(302, seeded ? '/designer' : '/admin');
	}
};
