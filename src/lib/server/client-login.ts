import { findContactsByEmail } from './auth';
import { normalizeClientPhonePassword } from './client-password';
import {
	getClientByEmail,
	setClientPassword,
	upsertClient,
	type Client
} from './db';
import { hashPassword } from './password';
import { ensureValidZohoToken } from './zoho-token';

async function getValidZohoAccessToken() {
	const valid = await ensureValidZohoToken();
	return valid?.accessToken ?? null;
}

export async function reconcileClientPhoneLogin(email: string, password: string): Promise<Client | null> {
	const normalizedAttempt = normalizeClientPhonePassword(password);
	if (!normalizedAttempt) return null;

	try {
		const existing = await getClientByEmail(email);
		const normalizedExistingPhone = normalizeClientPhonePassword(existing?.phone);
		if (existing && normalizedExistingPhone && normalizedExistingPhone === normalizedAttempt) {
			await setClientPassword(existing.id, await hashPassword(normalizedAttempt));
			return existing;
		}

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

		await setClientPassword(saved.id, await hashPassword(normalizedAttempt));
		return saved;
	} catch (err) {
		console.error('Failed to reconcile client phone login', { email, error: err });
		return null;
	}
}
