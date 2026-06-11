import { env } from '$env/dynamic/private';

const ZOHO_BOOKS_API_BASE = env.ZOHO_BOOKS_API_BASE;
const ZOHO_BOOKS_ORG_ID = env.ZOHO_BOOKS_ORG_ID;

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

/**
 * Quote statuses that count toward the project's quoted total: accepted, or
 * any invoiced state (Books uses 'invoiced' and 'partially_invoiced').
 * Drafts, sent, declined, and expired quotes don't count.
 */
export function isCountedQuoteStatus(status: unknown): boolean {
	const s = String(status ?? '').toLowerCase();
	return s === 'accepted' || s.includes('invoiced');
}

export async function listEstimatesForCustomer(accessToken: string, customerId: string) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const response = await zohoBooksApiCall(
		accessToken,
		`/estimates?organization_id=${encodeURIComponent(ZOHO_BOOKS_ORG_ID)}&customer_id=${encodeURIComponent(
			customerId
		)}&sort_column=date&sort_order=D`
	);
	return response.estimates || [];
}

/** Full estimate detail (includes line_items). */
export async function getEstimateById(accessToken: string, estimateId: string) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const response = await zohoBooksApiCall(
		accessToken,
		`/estimates/${encodeURIComponent(estimateId)}?organization_id=${encodeURIComponent(ZOHO_BOOKS_ORG_ID)}`
	);
	return response.estimate || null;
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

export interface EstimateDraftPayload {
	customer_id: string;
	reference_number?: string;
	customer_notes?: string;
	line_items: Array<{
		description: string;
		quantity?: number;
		rate?: number;
	}>;
}

/**
 * Create a Zoho Books estimate (quote) in draft status. Returns the new estimate object.
 */
export async function createBooksEstimateDraft(
	accessToken: string,
	payload: EstimateDraftPayload
) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const response = await zohoBooksApiCall(
		accessToken,
		`/estimates?organization_id=${encodeURIComponent(ZOHO_BOOKS_ORG_ID)}`,
		{
			method: 'POST',
			body: JSON.stringify(payload)
		}
	);
	return response.estimate || null;
}

/**
 * Upload a file as an attachment on a Books estimate.
 * Books accepts multipart/form-data with field name `attachment`.
 */
export async function attachFileToBooksEstimate(
	accessToken: string,
	estimateId: string,
	file: { name: string; mimeType: string; bytes: ArrayBuffer }
) {
	if (!ZOHO_BOOKS_ORG_ID) {
		throw new Error('Missing ZOHO_BOOKS_ORG_ID');
	}
	const base = ZOHO_BOOKS_API_BASE || DEFAULT_BOOKS_BASE;
	const url = `${base}/estimates/${encodeURIComponent(estimateId)}/attachment?organization_id=${encodeURIComponent(
		ZOHO_BOOKS_ORG_ID
	)}`;
	const form = new FormData();
	form.append('attachment', new Blob([file.bytes], { type: file.mimeType }), file.name);
	const response = await fetch(url, {
		method: 'POST',
		headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
		body: form
	});
	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		throw new Error(`Books attachment upload failed: ${response.status} ${errorText}`);
	}
	return response.json().catch(() => null);
}
