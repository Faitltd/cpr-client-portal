import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { getBooksCustomerByEmail, listInvoicesForCustomer } from '$lib/server/books';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	try {
		const session = await getSession(sessionToken);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		const tokens = await getZohoTokens();
		if (!tokens) {
			throw error(500, 'Zoho tokens not configured');
		}

		let accessToken = tokens.access_token;
		if (new Date(tokens.expires_at) < new Date()) {
			const newTokens = await refreshAccessToken(tokens.refresh_token);
			accessToken = newTokens.access_token;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: newTokens.access_token,
				refresh_token: newTokens.refresh_token,
				expires_at: new Date(newTokens.expires_at).toISOString(),
				scope: tokens.scope
			});
		}

		const customer = await getBooksCustomerByEmail(accessToken, session.client.email);
		if (!customer) {
			return json({ data: [] });
		}

		const invoices = await listInvoicesForCustomer(accessToken, customer.contact_id);
		return json({ data: invoices });
	} catch (err) {
		console.error('Failed to fetch invoices:', err);
		throw error(500, 'Failed to fetch invoices');
	}
};
