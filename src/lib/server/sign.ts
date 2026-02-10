import { ZOHO_SIGN_API_BASE, ZOHO_SIGN_HOST } from '$env/static/private';

const DEFAULT_SIGN_BASE = 'https://sign.zoho.com/api/v1';

export async function zohoSignApiCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {}
) {
	const base = ZOHO_SIGN_API_BASE || DEFAULT_SIGN_BASE;
	const url = `${base}${endpoint}`;
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			'Content-Type': 'application/json',
			...options.headers
		}
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Zoho Sign API call failed: ${error}`);
	}

	return response.json();
}

export async function listSignRequestsByRecipient(accessToken: string, email: string) {
	const data = {
		page_context: {
			row_count: 100,
			start_index: 1,
			search_columns: {
				recipient_email: email
			},
			sort_column: 'created_time',
			sort_order: 'DESC'
		}
	};

	const response = await zohoSignApiCall(
		accessToken,
		`/requests?data=${encodeURIComponent(JSON.stringify(data))}`
	);
	return response.requests || [];
}

export async function getRequestDetails(accessToken: string, requestId: string) {
	const response = await zohoSignApiCall(accessToken, `/requests/${requestId}`);
	return response.requests?.[0] || null;
}

export async function getEmbedToken(
	accessToken: string,
	requestId: string,
	actionId: string,
	hostOverride?: string
) {
	const host = hostOverride || ZOHO_SIGN_HOST || '';
	const body = new URLSearchParams();
	if (host) {
		body.set('host', host);
	}
	const response = await zohoSignApiCall(
		accessToken,
		`/requests/${requestId}/actions/${actionId}/embedtoken`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		}
	);
	return response.signing_url || response.sign_url || response;
}
