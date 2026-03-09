import { describe, expect, it } from 'vitest';
import { hashPassword } from './password';
import { normalizeClientPhonePassword, verifyClientPasswordInput } from './client-password';

describe('normalizeClientPhonePassword', () => {
	it('normalizes formatted US phone numbers to digits', () => {
		expect(normalizeClientPhonePassword('(555) 123-4567')).toBe('5551234567');
	});

	it('drops a leading country code for 11-digit US numbers', () => {
		expect(normalizeClientPhonePassword('+1 (555) 123-4567')).toBe('5551234567');
	});

	it('drops extension digits after a valid US phone number', () => {
		expect(normalizeClientPhonePassword('781-223-4153 ext 99')).toBe('7812234153');
	});

	it('returns null when no digits are present', () => {
		expect(normalizeClientPhonePassword('ext. office')).toBeNull();
	});
});

describe('verifyClientPasswordInput', () => {
	it('accepts a stored normalized phone password when the input is formatted', () => {
		const stored = hashPassword('5551234567');
		expect(verifyClientPasswordInput('(555) 123-4567', stored)).toBe(true);
	});

	it('still accepts exact non-phone passwords', () => {
		const stored = hashPassword('custom-password');
		expect(verifyClientPasswordInput('custom-password', stored)).toBe(true);
	});
});
