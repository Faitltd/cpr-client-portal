import { ZOHO_BOOKS_API_BASE, ZOHO_BOOKS_ORG_ID } from '$env/static/private';

const DEFAULT_BOOKS_BASE = 'https://www.zohoapis.com/books/v3';

export async function zohoBooksApiCall(
	accessToken: string,
	endpoint: string,
	options: RequestInit = {}
) {
	const base = ZOHO_BOOKS_API_BASE || DEFAULT_BOOKS_BASE;
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
		throw new Error(`Zoho Books API call failed: ${error}`);
	}

	return response.json();
}

export async function getBooksCustomerByEmail(accessToken: string, email: string) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const response = await zohoBooksApiCall(
		accessToken,
		`/contacts?organization_id=${encodeURIComponent(ZOHO_BOOKS_ORG_ID)}&email=${encodeURIComponent(email)}`
	);
	return response.contacts?.[0] || null;
}

export async function listInvoicesForCustomer(accessToken: string, customerId: string) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const response = await zohoBooksApiCall(
		accessToken,
		`/invoices?organization_id=${encodeURIComponent(ZOHO_BOOKS_ORG_ID)}&customer_id=${encodeURIComponent(
			customerId
		)}&sort_column=date&sort_order=D`
	);
	return response.invoices || [];
}
