import { redirect } from '@sveltejs/kit';
import { getTradeSession } from '$lib/server/db';
import type { PageServerLoad } from './$types';

// Session guard only — checklist data is fetched client-side from
// /api/trade/checklists/[projectId] after the page paints.
export const load: PageServerLoad = async ({ cookies, params }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw redirect(302, '/auth/trade');

	const session = await getTradeSession(sessionToken);
	if (!session) throw redirect(302, '/auth/trade');

	return {
		tradePartner: session.trade_partner,
		projectId: params.projectId
	};
};
