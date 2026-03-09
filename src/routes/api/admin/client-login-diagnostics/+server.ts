import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { findContactsByEmail } from '$lib/server/auth';
import { normalizeClientPhonePassword } from '$lib/server/client-password';
import { getClientByEmail, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

async function getValidZohoAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) return null;

	if (new Date(tokens.expires_at) >= new Date()) {
		return tokens.access_token;
	}

	const refreshed = await refreshAccessToken(tokens.refresh_token);
	await upsertZohoTokens({
		user_id: tokens.user_id,
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token,
		expires_at: new Date(refreshed.expires_at).toISOString(),
		scope: tokens.scope
	});

	return refreshed.access_token;
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const email = url.searchParams.get('email')?.trim().toLowerCase() || '';
	const phone = url.searchParams.get('phone')?.trim() || '';

	if (!email) {
		return json({ error: 'Missing email query parameter' }, { status: 400 });
	}

	try {
		const existingClient = await getClientByEmail(email);
		const normalizedAttempt = normalizeClientPhonePassword(phone);
		const normalizedExistingPhone = normalizeClientPhonePassword(existingClient?.phone);

		const accessToken = await getValidZohoAccessToken();
		const zohoContacts = accessToken ? await findContactsByEmail(accessToken, email) : [];

		return json({
			email,
			input: {
				phone,
				normalized_phone: normalizedAttempt
			},
			existing_client: existingClient
				? {
						id: existingClient.id,
						zoho_contact_id: existingClient.zoho_contact_id,
						email: existingClient.email,
						full_name: existingClient.full_name,
						phone: existingClient.phone,
						normalized_phone: normalizedExistingPhone,
						portal_active: existingClient.portal_active,
						local_phone_matches_input: Boolean(
							normalizedAttempt && normalizedExistingPhone && normalizedAttempt === normalizedExistingPhone
						)
					}
				: null,
			zoho_contacts: zohoContacts.map((contact) => {
				const normalizedZohoPhone = normalizeClientPhonePassword(contact.phone);
				return {
					zoho_contact_id: contact.zoho_contact_id,
					email: contact.email,
					full_name: contact.full_name,
					phone: contact.phone,
					normalized_phone: normalizedZohoPhone,
					zoho_phone_matches_input: Boolean(
						normalizedAttempt && normalizedZohoPhone && normalizedAttempt === normalizedZohoPhone
					)
				};
			})
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[GET /api/admin/client-login-diagnostics]', { email, error: err });
		return json({ error: message, email }, { status: 500 });
	}
};
