import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '$lib/server/password';

describe('password hashing', () => {
	it('hashPassword returns a non-empty string', () => {
		const hashed = hashPassword('correct-horse-battery-staple');
		expect(typeof hashed).toBe('string');
		expect(hashed.length).toBeGreaterThan(0);
	});

	it('hashPassword returns a structured pbkdf2 string', () => {
		const hashed = hashPassword('format-check');
		const parts = hashed.split('$');
		expect(parts).toHaveLength(4);

		const [prefix, iterationsRaw, salt, digest] = parts;
		expect(prefix).toBe('pbkdf2_sha256');

		const iterations = Number(iterationsRaw);
		expect(Number.isFinite(iterations)).toBe(true);
		expect(iterations).toBeGreaterThan(0);

		expect(salt.length).toBe(32);
		expect(salt).toMatch(/^[a-f0-9]+$/i);

		expect(digest.length).toBe(64);
		expect(digest).toMatch(/^[a-f0-9]+$/i);
	});

	it('verifyPassword succeeds for the correct password', () => {
		const password = 'super-secret';
		const hashed = hashPassword(password);
		expect(verifyPassword(password, hashed)).toBe(true);
	});

	it('verifyPassword rejects the wrong password', () => {
		const hashed = hashPassword('correct');
		expect(verifyPassword('wrong', hashed)).toBe(false);
	});

	it('different passwords produce different hashes', () => {
		const alpha = hashPassword('alpha');
		const beta = hashPassword('beta');
		expect(alpha).not.toBe(beta);
	});

	it('handles empty passwords without throwing', () => {
		expect(() => hashPassword('')).not.toThrow();
		const hashed = hashPassword('');
		expect(verifyPassword('', hashed)).toBe(true);
	});
});
