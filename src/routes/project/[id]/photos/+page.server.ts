import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

function toSafeIso(value: unknown, fallback?: unknown): string {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

export const load: PageServerLoad = async ({ params, cookies }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) return {};

	const session = await getSession(sessionToken);
	if (!session?.client) return {};

	const dealId = String(params.id || '').trim();
	if (!dealId) return {};

	try {
		const tokens = await getZohoTokens();
		if (!tokens) return {};

		let accessToken = tokens.access_token;
		let apiDomain = tokens.api_domain || undefined;
		if (new Date(tokens.expires_at) < new Date()) {
			const refreshed = await refreshAccessToken(tokens.refresh_token);
			accessToken = refreshed.access_token;
			apiDomain = refreshed.api_domain || apiDomain;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: tokens.refresh_token,
				expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
				scope: tokens.scope
			});
		}

		const dealPayload = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent('Client_Portal_Folder,External_Link')}`,
			{},
			apiDomain
		);
		const deal = dealPayload?.data?.[0];

		const crmUrl =
			(typeof deal?.Client_Portal_Folder === 'string' &&
			/zohoexternal\.com/i.test(deal.Client_Portal_Folder)
				? deal.Client_Portal_Folder
				: null) ||
			(typeof deal?.External_Link === 'string' && /zohoexternal\.com/i.test(deal.External_Link)
				? deal.External_Link
				: null);

		if (crmUrl) {
			throw redirect(302, crmUrl);
		}
	} catch (err) {
		// Re-throw SvelteKit redirects; swallow everything else so the page still loads
		if (err instanceof Response || (err as any)?.status === 302) throw err;
	}

	return {};
};
