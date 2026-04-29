import { json } from '@sveltejs/kit';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import type { RequestHandler } from './$types';

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const result = await loadTradePageContext(sessionToken, { includeDetailFields: true });

	if (result.redirectTo) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	return json({
		deals: result.deals,
		warning: result.warning,
		syncing: result.syncing ?? false
	});
};
