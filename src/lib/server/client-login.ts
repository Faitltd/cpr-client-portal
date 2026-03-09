import { findContactsByEmail } from './auth';
import { normalizeClientPhonePassword } from './client-password';
import {
	getZohoTokens,
	setClientPassword,
	upsertClient,
	upsertZohoTokens,
	type Client
} from './db';
import { hashPassword } from './password';
import { refreshAccessToken } from './zoho';

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

export async function reconcileClientPhoneLogin(email: string, password: string): Promise<Client | null> {
	const normalizedAttempt = normalizeClientPhonePassword(password);
	if (!normalizedAttempt) return null;

	try {
		const accessToken = await getValidZohoAccessToken();
		if (!accessToken) return null;

		const contacts = await findContactsByEmail(accessToken, email);
		const contact = contacts.find((candidate) => {
			const normalizedZohoPhone = normalizeClientPhonePassword(candidate.phone);
			return normalizedZohoPhone && normalizedZohoPhone === normalizedAttempt;
		});
		if (!contact?.email) {
			return null;
		}

		const saved = await upsertClient({
			...contact,
			portal_active: true
		});

		await setClientPassword(saved.id, hashPassword(normalizedAttempt));
		return saved;
	} catch (err) {
		console.error('Failed to reconcile client phone login', { email, error: err });
		return null;
	}
}
