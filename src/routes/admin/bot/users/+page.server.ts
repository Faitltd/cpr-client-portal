import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { listZohoTokens } from '$lib/server/db';
import type { PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const tokens = await listZohoTokens();
	return {
		tokens: tokens.map((t) => ({
			id: t.id,
			user_id: t.user_id,
			user_email: t.user_email ?? null,
			is_primary: !!t.is_primary,
			expires_at: t.expires_at,
			scope: t.scope ?? ''
		}))
	};
};
