import { redirect, error, isRedirect } from '@sveltejs/kit';
import { exchangeCodeForTokens, getTokenInfo } from '$lib/server/zoho';
import { getZohoCurrentUser } from '$lib/server/auth';
import { upsertZohoTokens } from '$lib/server/db';
import { ZOHO_REDIRECT_URI, ZOHO_SCOPE } from '$env/static/private';
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
		const tokens = await exchangeCodeForTokens(code, ZOHO_REDIRECT_URI);
		let tokenInfo: Record<string, any> | null = null;
		try {
			tokenInfo = await getTokenInfo(tokens.access_token);
		} catch (infoErr) {
			console.warn('Token info fetch failed during OAuth callback', infoErr);
		}

		const tokenUserId =
			tokenInfo?.user_id ||
			tokenInfo?.userid ||
			tokenInfo?.uid ||
			tokenInfo?.user ||
			tokenInfo?.userId ||
			null;

		let userId = tokenUserId as string | null;
		try {
			const user = await getZohoCurrentUser(tokens.access_token, tokens.api_domain);
			userId = user.id;
		} catch (userErr) {
			const message = userErr instanceof Error ? userErr.message : String(userErr);
			if (!userId) {
				throw userErr;
			}
			console.warn('Zoho current user lookup failed during OAuth callback', message);
		}

		if (!userId) {
			throw new Error('Unable to determine Zoho user id from token info');
		}

		await upsertZohoTokens({
			user_id: userId,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: new Date(tokens.expires_at).toISOString(),
			scope: tokenInfo?.scope || ZOHO_SCOPE
		});

    throw redirect(302, '/admin/connected');
  } catch (err) {
    if (isRedirect(err)) {
      throw err;
    }
    console.error('Admin OAuth error:', err);
    throw error(500, 'Failed to authenticate with Zoho');
  }
};
