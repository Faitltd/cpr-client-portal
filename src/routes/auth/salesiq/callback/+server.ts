import { redirect, error, isRedirect } from '@sveltejs/kit';
import { exchangeSalesiqCodeForTokens } from '$lib/server/salesiq';
import { getTokenInfo } from '$lib/server/zoho';
import { upsertSalesiqTokens } from '$lib/server/db';
import { SALESIQ_REDIRECT_URI, SALESIQ_SCOPE } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const errorParam = url.searchParams.get('error');

	if (errorParam) {
		throw error(400, `OAuth error: ${errorParam}`);
	}

	if (!code) {
		throw error(400, 'No authorization code provided');
	}

	try {
		const tokens = await exchangeSalesiqCodeForTokens(code, SALESIQ_REDIRECT_URI);
		let tokenInfo: Record<string, any> | null = null;
		try {
			tokenInfo = await getTokenInfo(tokens.access_token);
		} catch (infoErr) {
			console.warn('Token info fetch failed during SalesIQ OAuth callback', infoErr);
		}

		const tokenUserId =
			tokenInfo?.user_id ||
			tokenInfo?.userid ||
			tokenInfo?.uid ||
			tokenInfo?.user ||
			tokenInfo?.userId ||
			'salesiq';

		await upsertSalesiqTokens({
			user_id: String(tokenUserId),
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: new Date(tokens.expires_at).toISOString(),
			scope: tokenInfo?.scope || SALESIQ_SCOPE
		});

		throw redirect(302, '/admin/clients');
	} catch (err) {
		if (isRedirect(err)) {
			throw err;
		}
		console.error('SalesIQ OAuth error:', err);
		throw error(500, 'Failed to authenticate with SalesIQ');
	}
};
