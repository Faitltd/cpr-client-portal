import { redirect, error, isRedirect } from '@sveltejs/kit';
import { exchangeCodeForTokens } from '$lib/server/zoho';
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
    const user = await getZohoCurrentUser(tokens.access_token, tokens.api_domain);

    await upsertZohoTokens({
      user_id: user.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(tokens.expires_at).toISOString(),
      scope: ZOHO_SCOPE
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
