import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createAdminSession, getAdminSessionMaxAge, isAdminConfigured, isValidAdminSession } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

const PORTAL_ADMIN_PASSWORD = env.PORTAL_ADMIN_PASSWORD || '';

export const load: PageServerLoad = async ({ cookies }) => {
	if (isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/clients');
	}

	return {
		isConfigured: isAdminConfigured()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (!isAdminConfigured()) {
			return fail(500, { message: 'Admin password not configured.' });
		}

		const form = await request.formData();
		const password = String(form.get('password') || '');
		if (!PORTAL_ADMIN_PASSWORD || password !== PORTAL_ADMIN_PASSWORD) {
			return fail(401, { message: 'Invalid password.' });
		}

		const session = createAdminSession();
		cookies.set('admin_session', session, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: getAdminSessionMaxAge()
		});

		throw redirect(302, '/admin/clients');
	}
};
