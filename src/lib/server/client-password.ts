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

export async function verifyClientPasswordInput(
	password: string,
	stored: string | null
): Promise<boolean> {
	if (await verifyPassword(password, stored)) return true;

	const normalizedPhone = normalizeClientPhonePassword(password);
	if (!normalizedPhone || normalizedPhone === password) return false;

	return await verifyPassword(normalizedPhone, stored);
}
