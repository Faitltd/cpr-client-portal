import { redirect, error } from '@sveltejs/kit';
import { exchangeCodeForTokens } from '$lib/server/zoho';
import { ZOHO_REDIRECT_URI } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
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
		
		// TODO: Store tokens in Supabase associated with user session
		// For now, store in secure HTTP-only cookie
		cookies.set('zoho_access_token', tokens.access_token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 // 1 hour
		});

		cookies.set('zoho_refresh_token', tokens.refresh_token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30 // 30 days
		});

		throw redirect(302, '/dashboard');
	} catch (err) {
		console.error('Token exchange error:', err);
		throw error(500, 'Failed to authenticate with Zoho');
	}
};