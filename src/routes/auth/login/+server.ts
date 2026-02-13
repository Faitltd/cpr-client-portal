import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_CLIENT_ID = env.ZOHO_CLIENT_ID || '';
const ZOHO_AUTH_URL = env.ZOHO_AUTH_URL || '';
const ZOHO_REDIRECT_URI = env.ZOHO_REDIRECT_URI || '';
const ZOHO_SCOPE = env.ZOHO_SCOPE || '';

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
