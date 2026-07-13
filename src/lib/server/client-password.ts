import { verifyPassword } from './password';

export function normalizeClientPhonePassword(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const digits = trimmed.replace(/\D/g, '');
	if (!digits) return null;
	const normalized = digits.match(/^1?(\d{10})/);
	if (normalized?.[1]) return normalized[1];
	return digits;
}

/**
 * Verify a client/trade password.
 * Phone-number login is allowed ONLY when the stored credential is still the
 * phone seed (no custom password set). Once a custom password exists, the phone
 * number no longer authenticates. `accountPhone` is the phone on file.
 */
export async function verifyClientPasswordInput(
	password: string,
	stored: string | null,
	accountPhone: string | null
): Promise<boolean> {
	// A correct current password (custom or the phone-as-current) always works.
	if (await verifyPassword(password, stored)) return true;

	// Fallback is permitted only if the stored hash IS the phone seed.
	const seed = normalizeClientPhonePassword(accountPhone);
	if (!seed) return false;
	const storedIsSeed = await verifyPassword(seed, stored);
	if (!storedIsSeed) return false; // custom password set -> no phone backdoor

	const typed = normalizeClientPhonePassword(password);
	return !!typed && typed === seed;
}
