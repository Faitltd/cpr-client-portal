import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getTradePartnerAuthByEmail: vi.fn(),
	createTradeSession: vi.fn(),
	verifyTradePartnerLogin: vi.fn()
}));

vi.mock('$app/environment', () => ({
	dev: false
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		PORTAL_LOGIN_TIMEOUT_MS: '5'
	}
}));

vi.mock('$lib/server/db', () => ({
	getTradePartnerAuthByEmail: mocks.getTradePartnerAuthByEmail,
	createTradeSession: mocks.createTradeSession
}));

vi.mock('$lib/server/trade-login', () => ({
	verifyTradePartnerLogin: mocks.verifyTradePartnerLogin
}));

import { POST } from './password/+server';

function createCookies() {
	return {
		get: vi.fn(),
		set: vi.fn()
	};
}

describe('POST /auth/trade/password', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a 503 JSON response when login work exceeds the timeout', async () => {
		mocks.getTradePartnerAuthByEmail.mockImplementation(
			() => new Promise(() => undefined)
		);

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

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			message: 'Login timed out, please retry.'
		});
	});
});
