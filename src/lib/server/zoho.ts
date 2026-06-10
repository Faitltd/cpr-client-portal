import { env } from '$env/dynamic/private';

const ZOHO_CLIENT_ID = env.ZOHO_CLIENT_ID || '';
const ZOHO_CLIENT_SECRET = env.ZOHO_CLIENT_SECRET || '';
const ZOHO_TOKEN_URL = env.ZOHO_TOKEN_URL || '';
const ZOHO_API_BASE = env.ZOHO_API_BASE || '';

interface ZohoTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	api_domain?: string;
	token_type: string;
}

interface ZohoToken {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	api_domain?: string;
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
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

// Single-flight guard: concurrent requests that all see an expired token
// would otherwise fire simultaneous refresh calls, tripping Zoho's refresh
// rate limit and clobbering each other's DB writes. Dedupe by refresh token.
const inFlightRefreshes = new Map<string, Promise<ZohoToken>>();

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<ZohoToken> {
	const existing = inFlightRefreshes.get(refreshToken);
	if (existing) return existing;

	const promise = doRefreshAccessToken(refreshToken).finally(() => {
		inFlightRefreshes.delete(refreshToken);
	});
	inFlightRefreshes.set(refreshToken, promise);
	return promise;
}

async function doRefreshAccessToken(refreshToken: string): Promise<ZohoToken> {
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

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Token refresh failed (HTTP ${response.status}): ${text}`);
	}

	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`Token refresh failed: non-JSON response: ${text.slice(0, 200)}`);
	}

	// Zoho often returns 200 OK with an `error` field in the body for rate
	// limits and revoked refresh tokens. Treat any such response as a failure
	// instead of poisoning the stored row with NaN expires_at.
	if (data?.error) {
		const desc = data.error_description ?? data.error;
		throw new Error(`Token refresh failed: ${desc}`);
	}

	if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
		throw new Error(
			`Token refresh failed: malformed response: ${text.slice(0, 200)}`
		);
	}

	return {
		access_token: data.access_token,
		refresh_token: refreshToken,
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

/**
 * Retrieve token metadata (debugging)
 */
export async function getTokenInfo(accessToken: string) {
	const origin = new URL(ZOHO_TOKEN_URL).origin;
	const url = `${origin}/oauth/v2/token/info?${new URLSearchParams({
		access_token: accessToken
	}).toString()}`;
	const response = await fetch(url, { method: 'GET' });
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Token info failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
	}
	// Zoho sometimes serves an HTML login page on this endpoint when the
	// origin sniffs the request as a browser. Don't crash; return null so the
	// caller can fall back to the env scope.
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('json')) {
		console.warn(
			`[zoho] token/info returned non-JSON (${contentType || 'no content-type'}); skipping`
		);
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		console.warn('[zoho] token/info JSON parse failed; skipping');
		return null;
	}
}

/**
 * Make authenticated API call to Zoho CRM
 */
export function getZohoApiBase(apiDomain?: string) {
	// `apiDomain` comes back from Zoho OAuth as something like `https://www.zohoapis.com`.
	// We want to preserve the API version path from `ZOHO_API_BASE` so we don't hardcode it.
	if (!apiDomain) return ZOHO_API_BASE;

	const domain = apiDomain.replace(/\/$/, '');
	if (!ZOHO_API_BASE) return `${domain}/crm/v8`;

	try {
		const envUrl = new URL(ZOHO_API_BASE);
		const pathname = envUrl.pathname.replace(/\/$/, '');
		const path = pathname && pathname !== '/' ? pathname : '/crm/v8';
		return `${domain}${path}`;
	} catch {
		return `${domain}/crm/v8`;
	}
}

export async function zohoApiCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {},
	apiDomain?: string
) {
	const base = getZohoApiBase(apiDomain);
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
		throw new Error(`Zoho API call failed: ${error}`);
	}

	return response.json();
}
