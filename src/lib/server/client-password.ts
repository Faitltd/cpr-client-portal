import { verifyPassword } from './password';

export function normalizeClientPhonePassword(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	const digits = trimmed.replace(/\D/g, '');
	if (!digits) return null;
	if (digits.length === 11 && digits.startsWith('1')) {
		return digits.slice(1);
	}
	return digits;
}

export function verifyClientPasswordInput(password: string, stored: string | null): boolean {
	if (verifyPassword(password, stored)) return true;

	const normalizedPhone = normalizeClientPhonePassword(password);
	if (!normalizedPhone || normalizedPhone === password) return false;

	return verifyPassword(normalizedPhone, stored);
}
