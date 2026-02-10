import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { zohoApiCall, refreshAccessToken } from '$lib/server/zoho';
import { getContactDocuments, getDealNotes } from '$lib/server/auth';
import type { RequestHandler } from './$types';

const sanitizeText = (value: unknown) => String(value ?? '').trim();

async function getAccessToken() {
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
		return { accessToken, apiDomain: newTokens.api_domain };
	}

	return { accessToken, apiDomain: tokens.api_domain };
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('portal_session');
	const dealId = params.id;

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	if (!dealId) {
		throw error(400, 'Deal ID required');
	}

	try {
		// Get session from database
		const session = await getSession(sessionToken);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		const { accessToken, apiDomain } = await getAccessToken();

		// Fetch deal details
		const dealResponse = await zohoApiCall(accessToken, `/Deals/${dealId}`, {}, apiDomain);
		const deal = dealResponse.data?.[0];

		if (!deal) {
			throw error(404, 'Deal not found');
		}

		// Security: Verify this deal belongs to the authenticated contact
		if (deal.Contact_Name?.id !== session.client.zoho_contact_id) {
			throw error(403, 'Access denied to this project');
		}

		// Fetch related data
		const [documents, notes] = await Promise.all([
			getContactDocuments(accessToken, dealId, apiDomain).catch(() => ({ data: [] })),
			getDealNotes(accessToken, dealId, apiDomain).catch(() => ({ data: [] }))
		]);

		return json({
			deal,
			documents: documents.data || [],
			notes: notes.data || []
		});
	} catch (err) {
		console.error('Failed to fetch project details:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch project details');
	}
};

export const PATCH: RequestHandler = async ({ params, cookies, request }) => {
	const sessionToken = cookies.get('portal_session');
	const dealId = params.id;

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	if (!dealId) {
		throw error(400, 'Deal ID required');
	}

	const payload = await request.json().catch(() => ({}));
	const wifi = sanitizeText(payload?.wifi);
	const garageCode = sanitizeText(payload?.garageCode ?? payload?.doorCode);

	if (!wifi || !garageCode) {
		throw error(400, 'WiFi and Door code are required.');
	}

	if (wifi.length > 200) {
		throw error(400, 'WiFi must be 200 characters or less.');
	}

	if (garageCode.length > 100) {
		throw error(400, 'Door code must be 100 characters or less.');
	}

	try {
		const session = await getSession(sessionToken);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		const { accessToken, apiDomain } = await getAccessToken();

		const dealResponse = await zohoApiCall(accessToken, `/Deals/${dealId}`, {}, apiDomain);
		const deal = dealResponse.data?.[0];
		if (!deal) {
			throw error(404, 'Deal not found');
		}

		if (deal.Contact_Name?.id !== session.client.zoho_contact_id) {
			throw error(403, 'Access denied to this project');
		}

		const updateResponse = await zohoApiCall(
			accessToken,
			`/Deals/${dealId}`,
			{
				method: 'PUT',
				body: JSON.stringify({
					data: [
						{
							WiFi: wifi,
							Garage_Code: garageCode
						}
					]
				})
			},
			apiDomain
		);

		const result = updateResponse.data?.[0];
		if (!result || result.status?.toLowerCase() !== 'success') {
			throw error(400, result?.message || 'Failed to update deal.');
		}

		return json({
			message: 'Deal updated successfully.',
			values: { WiFi: wifi, Garage_Code: garageCode }
		});
	} catch (err) {
		console.error('Failed to update deal:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to update deal.');
	}
};
