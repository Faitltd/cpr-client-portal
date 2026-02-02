import { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_TOKEN_URL, ZOHO_API_BASE } from '$env/static/private';

interface ZohoTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	api_domain: string;
	token_type: string;
}

interface ZohoToken {
	access_token: string;
	refresh_token: string;
	expires_at: number;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<ZohoToken> {
	const params = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: ZOHO_CLIENT_ID,
		client_secret: ZOHO_CLIENT_SECRET,
		redirect_uri: redirectUri,
		code
	});

	const response = await fetch(ZOHO_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const data: ZohoTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000
	};
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<ZohoToken> {
	const params = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: ZOHO_CLIENT_ID,
		client_secret: ZOHO_CLIENT_SECRET,
		refresh_token: refreshToken
	});

	const response = await fetch(ZOHO_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token refresh failed: ${error}`);
	}

	const data: ZohoTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: refreshToken,
		expires_at: Date.now() + data.expires_in * 1000
	};
}

/**
 * Make authenticated API call to Zoho CRM
 */
export async function zohoApiCall(accessToken: string, endpoint: string, options: RequestInit = {}) {
	const url = `${ZOHO_API_BASE}${endpoint}`;
	const response = await fetch(url, {
		...options,
		headers: {
			'Authorization': `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Zoho API call failed: ${error}`);
	}

	return response.json();
}