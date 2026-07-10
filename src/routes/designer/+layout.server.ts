import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getPortalPrincipal, isStaffAdmin, staffRoleOf } from '$lib/server/designer';
import { getTradePartnerAuthByEmail } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

const ALLOWED_CHAT_EMAILS = new Set(
	(env.BOT_CHAT_ALLOWED_EMAILS ?? '')
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
	const role = staffRoleOf(principal.session);
	const isAdmin = isStaffAdmin(cookies, email);
	const canChat = ALLOWED_CHAT_EMAILS.has(email);

	// The embedded Field Update form authenticates through a trade session, so
	// it needs a matching trade-partner record. Only relevant for designer/ops.
	let hasTradeRecord = false;
	if (role !== 'finance' || isAdmin) {
		try {
			hasTradeRecord = Boolean(await getTradePartnerAuthByEmail(email));
		} catch {
			hasTradeRecord = false;
		}
	}

	// Tab visibility per staff role. Admins see everything.
	const tabs = {
		fieldDashboard: isAdmin || role === 'ops',
		fieldUpdate: (isAdmin || role === 'designer' || role === 'ops') && hasTradeRecord,
		crm: true,
		tasks: isAdmin || role === 'designer' || role === 'ops',
		financials: isAdmin || role === 'ops' || role === 'finance',
		finance: isAdmin || role === 'finance',
		schedule: !isAdmin && (role === 'designer' || role === 'ops')
	};

	return {
		designer: principal.session.designer,
		role,
		tabs,
		canChat,
		isAdmin
	};
};
