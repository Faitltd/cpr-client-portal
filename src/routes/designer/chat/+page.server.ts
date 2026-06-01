import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getPortalPrincipal } from '$lib/server/designer';
import type { PageServerLoad } from './$types';

const ALLOWED_EMAILS = new Set(
	(env.BOT_CHAT_ALLOWED_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

export const load: PageServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));
	if (!principal) {
		throw redirect(302, '/auth/portal?next=/designer/chat');
	}
	if (principal.role !== 'designer') {
		throw redirect(302, '/dashboard');
	}

	const email = (principal.session.designer.email ?? '').toLowerCase();
	if (!ALLOWED_EMAILS.has(email)) {
		throw error(403, 'You do not have access to the project chat.');
	}

	return {
		designer: principal.session.designer
	};
};
