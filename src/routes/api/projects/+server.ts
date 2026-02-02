import { json, error } from '@sveltejs/kit';
import { zohoApiCall, refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	let accessToken = cookies.get('zoho_access_token');
	const refreshToken = cookies.get('zoho_refresh_token');

	if (!accessToken && !refreshToken) {
		throw error(401, 'Not authenticated');
	}

	try {
		// Attempt API call with current token
		const deals = await zohoApiCall(accessToken!, '/Deals', {
			method: 'GET'
		});

		return json(deals);
	} catch (err) {
		// Token expired, try refresh
		if (refreshToken) {
			try {
				const newTokens = await refreshAccessToken(refreshToken);
				
				cookies.set('zoho_access_token', newTokens.access_token, {
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'lax',
					maxAge: 60 * 60
				});

				// Retry with new token
				const deals = await zohoApiCall(newTokens.access_token, '/Deals', {
					method: 'GET'
				});

				return json(deals);
			} catch (refreshErr) {
				throw error(401, 'Token refresh failed');
			}
		}
		throw error(500, 'Failed to fetch projects');
	}
};