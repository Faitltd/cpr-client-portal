import { findContactsByEmail } from './auth';
import { normalizeClientPhonePassword } from './client-password';
import {
	getClientAuthByEmail,
	getClientByEmail,
	setClientPassword,
	upsertClient,
	type Client
} from './db';
import { hashPassword, verifyPassword } from './password';
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
			// Never let the phone number re-seed (and thus reset) a client who has
			// already set a custom password. Only reconcile when the stored
			// credential is still the phone seed or unset.
			const auth = await getClientAuthByEmail(email);
			const storedIsSeedOrEmpty = auth?.password_hash
				? await verifyPassword(normalizedAttempt, auth.password_hash)
				: true;
			if (!storedIsSeedOrEmpty) return null;
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
