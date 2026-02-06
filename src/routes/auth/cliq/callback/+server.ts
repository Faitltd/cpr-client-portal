import { redirect, error, isRedirect } from '@sveltejs/kit';
import { exchangeCliqCodeForTokens } from '$lib/server/cliq';
import { getTokenInfo } from '$lib/server/zoho';
import { upsertCliqTokens } from '$lib/server/db';
import { CLIQ_REDIRECT_URI, CLIQ_SCOPE } from '$env/static/private';
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
		const tokens = await exchangeCliqCodeForTokens(code, CLIQ_REDIRECT_URI);
		let tokenInfo: Record<string, any> | null = null;
		try {
			tokenInfo = await getTokenInfo(tokens.access_token);
		} catch (infoErr) {
			console.warn('Token info fetch failed during Cliq OAuth callback', infoErr);
		}

		const tokenUserId =
			tokenInfo?.user_id ||
			tokenInfo?.userid ||
			tokenInfo?.uid ||
			tokenInfo?.user ||
			tokenInfo?.userId ||
			'cliq';

		await upsertCliqTokens({
			user_id: String(tokenUserId),
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: new Date(tokens.expires_at).toISOString(),
			scope: tokenInfo?.scope || CLIQ_SCOPE
		});

		throw redirect(302, '/admin/clients');
	} catch (err) {
		if (isRedirect(err)) {
			throw err;
		}
		console.error('Cliq OAuth error:', err);
		throw error(500, 'Failed to authenticate with Cliq');
	}
};
