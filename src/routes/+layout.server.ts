import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = async ({ cookies }) => {
	return {
		hasPortalSession: Boolean(cookies.get('portal_session')),
		hasTradeSession: Boolean(cookies.get('trade_session')),
		hasAdminSession: Boolean(cookies.get('admin_session')),
		hasZProjectsConfigured: Boolean(env.ZOHO_PROJECTS_PORTAL_ID)
	};
};
