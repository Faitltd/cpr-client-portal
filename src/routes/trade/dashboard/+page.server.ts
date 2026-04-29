import { redirect } from '@sveltejs/kit';
import { getTradeSession } from '$lib/server/db';
import type { PageServerLoad } from './$types';

// Load only session data — no Zoho calls at all.
// Deals are fetched client-side via GET /api/trade/deals after the page paints.
export const load: PageServerLoad = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw redirect(302, '/auth/trade');

	const session = await getTradeSession(sessionToken);
	if (!session) throw redirect(302, '/auth/trade');

	return {
		tradePartner: session.trade_partner
	};
};
