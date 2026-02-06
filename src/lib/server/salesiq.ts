import {
	SALESIQ_CLIENT_ID,
	SALESIQ_CLIENT_SECRET,
	SALESIQ_TOKEN_URL,
	SALESIQ_API_BASE,
	SALESIQ_SCREEN_NAME
} from '$env/static/private';

interface SalesiqTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	api_domain?: string;
	token_type: string;
}

interface SalesiqToken {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	api_domain?: string;
}

function getSalesiqBase() {
	if (SALESIQ_API_BASE) return SALESIQ_API_BASE.replace(/\/$/, '');
	if (!SALESIQ_SCREEN_NAME) {
		throw new Error('Missing SALESIQ_SCREEN_NAME environment variable');
	}
	return `https://salesiq.zoho.com/api/v2/${SALESIQ_SCREEN_NAME}`;
}

/**
 * Exchange authorization code for SalesIQ tokens
 */
export async function exchangeSalesiqCodeForTokens(
	code: string,
	redirectUri: string
): Promise<SalesiqToken> {
	const params = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: SALESIQ_CLIENT_ID,
		client_secret: SALESIQ_CLIENT_SECRET,
		redirect_uri: redirectUri,
		code
	});

	const response = await fetch(SALESIQ_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`SalesIQ token exchange failed: ${error}`);
	}

	const data: SalesiqTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

/**
 * Refresh an expired SalesIQ access token
 */
export async function refreshSalesiqAccessToken(refreshToken: string): Promise<SalesiqToken> {
	const params = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: SALESIQ_CLIENT_ID,
		client_secret: SALESIQ_CLIENT_SECRET,
		refresh_token: refreshToken
	});

	const response = await fetch(SALESIQ_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`SalesIQ token refresh failed: ${error}`);
	}

	const data: SalesiqTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: refreshToken,
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

/**
 * Make authenticated API call to SalesIQ
 */
export async function salesiqApiCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {}
) {
	const base = getSalesiqBase();
	const url = `${base}${endpoint}`;
	const response = await fetch(url, {
		...options,
		headers: {
			'Authorization': `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (response.status === 204) {
		return { data: [] };
	}

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`SalesIQ API call failed: ${error}`);
	}

	return response.json();
}
