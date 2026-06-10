import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getPortalPrincipal } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

const ALLOWED_CHAT_EMAILS = new Set(
	(env.BOT_CHAT_ALLOWED_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

// Admins see an extra Admin tab linking to the portal-passwords / sync page.
// Configurable via PORTAL_ADMIN_EMAILS (comma-separated); defaults to Ray.
const ADMIN_EMAILS = new Set(
	(env.PORTAL_ADMIN_EMAILS ?? 'ray@homecpr.pro')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

export const load: LayoutServerLoad = async ({ cookies }) => {
	const principal = await getPortalPrincipal(cookies.get('portal_session'));

	if (!principal) {
		throw redirect(302, '/auth/portal?next=/designer');
	}

	if (principal.role !== 'designer') {
		// Authenticated but wrong role — send clients to their own dashboard.
		throw redirect(302, '/dashboard');
	}

	const email = (principal.session.designer.email ?? '').toLowerCase();
	const canChat = ALLOWED_CHAT_EMAILS.has(email);

	// Dual-role: designers who are also trade partners get the Trade Dashboard +
	// Field Update tabs. Detected by a matching trade-partner record.
	let hasTrade = false;
	try {
		hasTrade = Boolean(await getTradePartnerAuthByEmail(email));
	} catch {
		hasTrade = false;
	}

	return {
		designer: principal.session.designer,
		canChat,
		hasTrade,
		isAdmin: ADMIN_EMAILS.has(email)
	};
};
