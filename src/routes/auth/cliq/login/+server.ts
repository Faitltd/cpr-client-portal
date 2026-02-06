import { redirect } from '@sveltejs/kit';
import {
	CLIQ_CLIENT_ID,
	CLIQ_AUTH_URL,
	CLIQ_REDIRECT_URI,
	CLIQ_SCOPE,
	ZOHO_AUTH_URL
} from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const authUrlBase = CLIQ_AUTH_URL || ZOHO_AUTH_URL;
	if (!authUrlBase) {
		throw new Error('Missing CLIQ_AUTH_URL/ZOHO_AUTH_URL');
	}

	const params = new URLSearchParams({
		scope: CLIQ_SCOPE,
		client_id: CLIQ_CLIENT_ID,
		response_type: 'code',
		access_type: 'offline',
		redirect_uri: CLIQ_REDIRECT_URI,
		prompt: 'consent'
	});

	const authUrl = `${authUrlBase}?${params.toString()}`;
	throw redirect(302, authUrl);
};
