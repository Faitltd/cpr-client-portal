import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	setTradePartnerPassword: vi.fn(),
	hashPassword: vi.fn(),
	verifyPassword: vi.fn()
}));

vi.mock('./db', () => ({
	setTradePartnerPassword: mocks.setTradePartnerPassword
}));

vi.mock('./password', () => ({
	hashPassword: mocks.hashPassword,
	verifyPassword: mocks.verifyPassword
}));

import { verifyTradePartnerLogin } from './trade-login';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('verifyTradePartnerLogin', () => {
	it('returns true after a single successful password verification', async () => {
		mocks.verifyPassword.mockResolvedValue(true);

		const result = await verifyTradePartnerLogin(
			{
				id: 'tp-1',
				email: 'trade@example.com',
				password_hash: 'stored-hash',
				phone: '(555) 123-4567'
			},
			'custom-password'
		);

		expect(result).toBe(true);
		expect(mocks.verifyPassword).toHaveBeenCalledTimes(1);
		expect(mocks.verifyPassword).toHaveBeenCalledWith('custom-password', 'stored-hash');
		expect(mocks.setTradePartnerPassword).not.toHaveBeenCalled();
	});

	it('does not retry a normalized phone variant when a stored hash exists and the check fails', async () => {
		mocks.verifyPassword.mockResolvedValue(false);

		const result = await verifyTradePartnerLogin(
			{
				id: 'tp-2',
				email: 'trade@example.com',
				password_hash: 'stored-hash',
				phone: '(555) 123-4567'
			},
			'(555) 123-4567'
		);

		expect(result).toBe(false);
		expect(mocks.verifyPassword).toHaveBeenCalledTimes(1);
		expect(mocks.verifyPassword).toHaveBeenCalledWith('(555) 123-4567', 'stored-hash');
		expect(mocks.hashPassword).not.toHaveBeenCalled();
		expect(mocks.setTradePartnerPassword).not.toHaveBeenCalled();
	});

	it('seeds a password from the normalized phone only when no password hash is stored', async () => {
		mocks.hashPassword.mockResolvedValue('fresh-hash');
		mocks.setTradePartnerPassword.mockResolvedValue(undefined);

		const result = await verifyTradePartnerLogin(
			{
				id: 'tp-3',
				email: 'trade@example.com',
				password_hash: null,
				phone: '555-123-4567'
			},
			'(555) 123-4567'
		);

		expect(result).toBe(true);
		expect(mocks.verifyPassword).not.toHaveBeenCalled();
		expect(mocks.hashPassword).toHaveBeenCalledWith('5551234567');
		expect(mocks.setTradePartnerPassword).toHaveBeenCalledWith('tp-3', 'fresh-hash');
	});
});
