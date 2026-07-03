import { redirect } from '@sveltejs/kit';
import { getTradeSession } from '$lib/server/db';
import type { PageServerLoad } from './$types';

// Gate the tool behind a valid trade session, mirroring the dashboard.
// The before/after app itself is fully client-side (camera + IndexedDB),
// so there are no Zoho calls here.
export const load: PageServerLoad = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw redirect(302, '/auth/trade');

	const session = await getTradeSession(sessionToken);
	if (!session) throw redirect(302, '/auth/trade');

	return {
		tradePartner: session.trade_partner
	};
};
