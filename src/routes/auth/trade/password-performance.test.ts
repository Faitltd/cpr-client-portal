import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getTradePartnerAuthByEmail: vi.fn(),
	createTradeSession: vi.fn()
}));

vi.mock('$app/environment', () => ({
	dev: false
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		PORTAL_LOGIN_TIMEOUT_MS: '10000'
	}
}));

vi.mock('$lib/server/db', () => ({
	getTradePartnerAuthByEmail: mocks.getTradePartnerAuthByEmail,
	createTradeSession: mocks.createTradeSession
}));

import { hashPassword } from '$lib/server/password';
import { POST } from './password/+server';

function createCookies() {
	return {
		get: vi.fn(),
		set: vi.fn()
	};
}

describe('POST /auth/trade/password performance', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('completes a successful JSON login in under 500ms locally', async () => {
		const storedHash = await hashPassword('super-secret');
		mocks.getTradePartnerAuthByEmail.mockResolvedValue({
			id: 'tp-1',
			email: 'trade@example.com',
			password_hash: storedHash,
			phone: '(555) 123-4567'
		});
		mocks.createTradeSession.mockResolvedValue(undefined);

		const startedAt = performance.now();
		const response = await POST({
			request: new Request('http://localhost/auth/trade/password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					email: 'trade@example.com',
					password: 'super-secret'
				})
			}),
			cookies: createCookies(),
			getClientAddress: () => '127.0.0.1'
		} as any);
		const durationMs = performance.now() - startedAt;

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ message: 'Login successful.' });
		expect(durationMs).toBeLessThan(500);
	});
});
