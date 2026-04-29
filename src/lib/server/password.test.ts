import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '$lib/server/password';

describe('password hashing', () => {
	it('hashPassword returns a non-empty string', async () => {
		const hashed = await hashPassword('correct-horse-battery-staple');
		expect(typeof hashed).toBe('string');
		expect(hashed.length).toBeGreaterThan(0);
	});

	it('hashPassword returns a structured pbkdf2 string', async () => {
		const hashed = await hashPassword('format-check');
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

	it('verifyPassword succeeds for the correct password', async () => {
		const password = 'super-secret';
		const hashed = await hashPassword(password);
		expect(await verifyPassword(password, hashed)).toBe(true);
	});

	it('verifyPassword rejects the wrong password', async () => {
		const hashed = await hashPassword('correct');
		expect(await verifyPassword('wrong', hashed)).toBe(false);
	});

	it('verifyPassword accepts stored hashes with surrounding whitespace', async () => {
		const hashed = await hashPassword('trim-check');
		expect(await verifyPassword('trim-check', `  ${hashed}  `)).toBe(true);
	});

	it('different passwords produce different hashes', async () => {
		const alpha = await hashPassword('alpha');
		const beta = await hashPassword('beta');
		expect(alpha).not.toBe(beta);
	});

	it('handles empty passwords without throwing', async () => {
		await expect(hashPassword('')).resolves.toEqual(expect.any(String));
		const hashed = await hashPassword('');
		expect(await verifyPassword('', hashed)).toBe(true);
	});
});
