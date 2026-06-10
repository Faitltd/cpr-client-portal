import { beforeEach, describe, expect, it } from 'vitest';
import { checkLoginRateLimit, resetLoginRateLimits } from './rate-limit';

describe('checkLoginRateLimit', () => {
	beforeEach(() => {
		resetLoginRateLimits();
	});

	it('allows attempts under the per-identity limit', () => {
		for (let i = 0; i < 10; i += 1) {
			expect(checkLoginRateLimit('user@example.com', '1.2.3.4').allowed).toBe(true);
		}
	});

	it('blocks the identity after exceeding the limit and reports retry time', () => {
		for (let i = 0; i < 10; i += 1) {
			checkLoginRateLimit('user@example.com', '1.2.3.4');
		}
		const result = checkLoginRateLimit('user@example.com', '1.2.3.4');
		expect(result.allowed).toBe(false);
		expect(result.retryAfterSec).toBeGreaterThan(0);
	});

	it('tracks identities independently', () => {
		for (let i = 0; i < 11; i += 1) {
			checkLoginRateLimit('a@example.com', '1.2.3.4');
		}
		expect(checkLoginRateLimit('b@example.com', '5.6.7.8').allowed).toBe(true);
	});

	it('blocks an IP that sprays many identities', () => {
		for (let i = 0; i < 50; i += 1) {
			checkLoginRateLimit(`user${i}@example.com`, '9.9.9.9');
		}
		const result = checkLoginRateLimit('fresh@example.com', '9.9.9.9');
		expect(result.allowed).toBe(false);
	});

	it('treats missing IPs as a shared bucket without throwing', () => {
		expect(checkLoginRateLimit('user@example.com', null).allowed).toBe(true);
	});
});
