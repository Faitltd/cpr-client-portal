import { redirect } from '@sveltejs/kit';
import {
	SALESIQ_CLIENT_ID,
	SALESIQ_AUTH_URL,
	SALESIQ_REDIRECT_URI,
	SALESIQ_SCOPE,
	ZOHO_AUTH_URL
} from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const authUrlBase = SALESIQ_AUTH_URL || ZOHO_AUTH_URL;
	if (!authUrlBase) {
		throw new Error('Missing SALESIQ_AUTH_URL/ZOHO_AUTH_URL');
	}

	const params = new URLSearchParams({
		scope: SALESIQ_SCOPE,
		client_id: SALESIQ_CLIENT_ID,
		response_type: 'code',
		access_type: 'offline',
		redirect_uri: SALESIQ_REDIRECT_URI,
		prompt: 'consent'
	});

	const authUrl = `${authUrlBase}?${params.toString()}`;
	throw redirect(302, authUrl);
};
