import { redirect, error } from '@sveltejs/kit';
import { exchangeCodeForTokens } from '$lib/server/zoho';
import { getAuthenticatedContact } from '$lib/server/auth';
import { upsertSession, updateUserLogin } from '$lib/server/db';
import { ZOHO_REDIRECT_URI } from '$env/static/private';
import type { RequestHandler } from './$types';
import { randomBytes } from 'crypto';

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
		// Exchange code for tokens
		const tokens = await exchangeCodeForTokens(code, ZOHO_REDIRECT_URI);
		
		// Identify the authenticated contact
		const contact = await getAuthenticatedContact(tokens.access_token);
		
		// Generate secure session ID
		const sessionId = randomBytes(32).toString('hex');
		
		// Store session in Supabase
		await upsertSession({
			user_id: sessionId,
			email: contact.email,
			name: contact.name,
			zoho_contact_id: contact.zoho_contact_id,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: new Date(tokens.expires_at).toISOString()
		});
		
		// Update last login timestamp
		await updateUserLogin(contact.zoho_contact_id);
		
		// Set secure session cookie (no tokens exposed to client)
		cookies.set('portal_session', sessionId, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 7 // 7 days
		});

		throw redirect(302, '/dashboard');
	} catch (err) {
		console.error('Authentication error:', err);
		throw error(500, 'Failed to authenticate with Zoho');
	}
};