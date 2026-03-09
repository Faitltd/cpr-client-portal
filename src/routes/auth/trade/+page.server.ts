import { redirect } from '@sveltejs/kit';
import { getTradeSession } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) return {};

	const session = await getTradeSession(sessionToken);
	if (session) {
		throw redirect(302, '/trade/dashboard');
	}

	return {};
};
