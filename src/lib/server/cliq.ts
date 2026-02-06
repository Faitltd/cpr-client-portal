import {
	CLIQ_API_BASE,
	CLIQ_CLIENT_ID,
	CLIQ_CLIENT_SECRET,
	CLIQ_TOKEN_URL
} from '$env/static/private';

interface CliqTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	api_domain?: string;
	token_type: string;
}

interface CliqToken {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	api_domain?: string;
}

function getCliqBase() {
	return (CLIQ_API_BASE || 'https://cliq.zoho.com/api/v2').replace(/\/$/, '');
}

export async function cliqApiCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {}
) {
	const base = getCliqBase();
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
		throw new Error(`Cliq API call failed: ${error}`);
	}

	return response.json();
}

/**
 * Exchange authorization code for Cliq tokens
 */
export async function exchangeCliqCodeForTokens(
	code: string,
	redirectUri: string
): Promise<CliqToken> {
	const params = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: CLIQ_CLIENT_ID,
		client_secret: CLIQ_CLIENT_SECRET,
		redirect_uri: redirectUri,
		code
	});

	const response = await fetch(CLIQ_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cliq token exchange failed: ${error}`);
	}

	const data: CliqTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

/**
 * Refresh an expired Cliq access token
 */
export async function refreshCliqAccessToken(refreshToken: string): Promise<CliqToken> {
	const params = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: CLIQ_CLIENT_ID,
		client_secret: CLIQ_CLIENT_SECRET,
		refresh_token: refreshToken
	});

	const response = await fetch(CLIQ_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cliq token refresh failed: ${error}`);
	}

	const data: CliqTokenResponse = await response.json();
	return {
		access_token: data.access_token,
		refresh_token: refreshToken,
		expires_at: Date.now() + data.expires_in * 1000,
		api_domain: data.api_domain
	};
}

export async function createCliqChannel(
	accessToken: string,
	payload: {
		name: string;
		description?: string;
		level?: 'organization' | 'external';
		invite_only?: boolean;
		email_ids?: string[];
	}
) {
	return cliqApiCall(accessToken, '/channels', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
}

export async function findCliqChannelByName(accessToken: string, name: string) {
	const params = new URLSearchParams({ name });
	return cliqApiCall(accessToken, `/channels?${params.toString()}`, { method: 'GET' });
}

export async function postCliqChannelMessage(
	accessToken: string,
	channelIdOrName: string,
	message: string,
	useName = false
) {
	const endpoint = useName
		? `/channelsbyname/${encodeURIComponent(channelIdOrName)}/message`
		: `/channels/${encodeURIComponent(channelIdOrName)}/message`;
	return cliqApiCall(accessToken, endpoint, {
		method: 'POST',
		body: JSON.stringify({ text: message })
	});
}
