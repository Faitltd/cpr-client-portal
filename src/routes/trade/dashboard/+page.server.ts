import { redirect } from '@sveltejs/kit';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const result = await loadTradePageContext(cookies.get('trade_session'), {
		includeDetailFields: true
	});

	if (result.redirectTo) {
		throw redirect(302, result.redirectTo);
	}

	return {
		tradePartner: result.tradePartner,
		deals: result.deals,
		warning: result.warning
	};
};
