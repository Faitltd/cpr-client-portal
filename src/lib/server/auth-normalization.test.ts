import { describe, expect, it, vi } from 'vitest';
import {
	findNormalizedEmailMatch,
	normalizeEmailAddress,
	normalizeStoredPasswordHash
} from './auth-normalization';

describe('normalizeEmailAddress', () => {
	it('trims and lowercases email addresses', () => {
		expect(normalizeEmailAddress('  Ray.Kinne@Example.com  ')).toBe('ray.kinne@example.com');
	});

	it('returns an empty string for non-string values', () => {
		expect(normalizeEmailAddress(null)).toBe('');
		expect(normalizeEmailAddress(undefined)).toBe('');
	});
});

describe('normalizeStoredPasswordHash', () => {
	it('trims stored password hashes', () => {
		expect(normalizeStoredPasswordHash('  pbkdf2_sha256$1$salt$hash  ')).toBe(
			'pbkdf2_sha256$1$salt$hash'
		);
	});

	it('returns null for empty values', () => {
		expect(normalizeStoredPasswordHash('   ')).toBeNull();
		expect(normalizeStoredPasswordHash(null)).toBeNull();
	});
});

describe('findNormalizedEmailMatch', () => {
	it('matches rows whose stored email has surrounding whitespace', () => {
		const match = findNormalizedEmailMatch(
			[
				{ id: '1', email: '  ray@example.com  ' },
				{ id: '2', email: 'other@example.com' }
			],
			'ray@example.com'
		);

		expect(match).toEqual({ id: '1', email: '  ray@example.com  ' });
	});

	it('returns null and warns when multiple records collapse to the same normalized email', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const result = findNormalizedEmailMatch(
				[
					{ id: '1', email: 'ray@example.com' },
					{ id: '2', email: ' Ray@example.com ' }
				],
				'ray@example.com'
			);

			expect(result).toBeNull();
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Multiple records matched normalized email ray@example.com')
			);
		} finally {
			warn.mockRestore();
		}
	});
});
