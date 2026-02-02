import { redirect } from '@sveltejs/kit';
import { ZOHO_CLIENT_ID, ZOHO_AUTH_URL, ZOHO_REDIRECT_URI, ZOHO_SCOPE } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const params = new URLSearchParams({
		scope: ZOHO_SCOPE,
		client_id: ZOHO_CLIENT_ID,
		response_type: 'code',
		access_type: 'offline',
		redirect_uri: ZOHO_REDIRECT_URI,
		prompt: 'consent'
	});

	const authUrl = `${ZOHO_AUTH_URL}?${params.toString()}`;
	throw redirect(302, authUrl);
};