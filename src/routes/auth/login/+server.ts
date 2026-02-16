import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_CLIENT_ID = env.ZOHO_CLIENT_ID || '';
const ZOHO_AUTH_URL = env.ZOHO_AUTH_URL || '';
const ZOHO_REDIRECT_URI = env.ZOHO_REDIRECT_URI || '';
const ZOHO_SCOPE = env.ZOHO_SCOPE || '';

function normalizeZohoScope(scope: string) {
	// Zoho expects a comma-separated list of scope tokens.
	// If there are leading/trailing spaces (common when copy/pasting), Zoho treats them as part of
	// the scope string and returns "Scope does not exist".
	const trimmed = scope.trim();

	// Some env UIs include surrounding quotes in the value; strip a single pair if present.
	const unquoted =
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
			? trimmed.slice(1, -1)
			: trimmed;

	return unquoted
		.split(/[\s,]+/g)
		.map((value) => value.trim())
		.filter(Boolean)
		.join(',');
}

export const GET: RequestHandler = async () => {
	const params = new URLSearchParams({
		scope: normalizeZohoScope(ZOHO_SCOPE),
		client_id: ZOHO_CLIENT_ID,
		response_type: 'code',
		access_type: 'offline',
		redirect_uri: ZOHO_REDIRECT_URI,
		prompt: 'consent'
	});

	const authUrl = `${ZOHO_AUTH_URL}?${params.toString()}`;
	throw redirect(302, authUrl);
};
