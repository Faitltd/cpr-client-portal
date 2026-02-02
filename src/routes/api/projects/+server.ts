import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { getContactDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get('portal_session');

	if (!sessionId) {
		throw error(401, 'Not authenticated');
	}

	try {
		// Get session from database
		const session = await getSession(sessionId);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		// Check if token expired
		let accessToken = session.access_token;
		if (new Date(session.expires_at) < new Date()) {
			// Refresh token
			const newTokens = await refreshAccessToken(session.refresh_token);
			accessToken = newTokens.access_token;
			// TODO: Update session in database with new tokens
		}

		// Fetch ONLY deals associated with this contact
		const deals = await getContactDeals(accessToken, session.zoho_contact_id);

		return json({ data: deals });
	} catch (err) {
		console.error('Failed to fetch projects:', err);
		throw error(500, 'Failed to fetch projects');
	}
};