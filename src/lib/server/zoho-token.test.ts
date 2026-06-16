import { beforeEach, describe, expect, it, vi } from 'vitest';

const getZohoTokensMock = vi.fn();
const getZohoTokenByUserIdMock = vi.fn();
const upsertZohoTokensMock = vi.fn();
const refreshAccessTokenMock = vi.fn();

vi.mock('./db', () => ({
	getZohoTokens: (...args: unknown[]) => getZohoTokensMock(...args),
	getZohoTokenByUserId: (...args: unknown[]) => getZohoTokenByUserIdMock(...args),
	upsertZohoTokens: (...args: unknown[]) => upsertZohoTokensMock(...args)
}));

vi.mock('./zoho', () => ({
	refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args)
}));

async function loadModule() {
	vi.resetModules();
	return import('./zoho-token');
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

function tokenRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'row1',
		user_id: 'user-123',
		access_token: 'stored-access',
		refresh_token: 'stored-refresh',
		expires_at: FUTURE,
		scope: 'ZohoCRM.modules.ALL',
		user_email: 'admin@example.com',
		is_primary: true,
		...overrides
	};
}

describe('ensureValidZohoToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null when no token is configured', async () => {
		getZohoTokensMock.mockResolvedValue(null);
		const { ensureValidZohoToken } = await loadModule();
		expect(await ensureValidZohoToken()).toBeNull();
		expect(refreshAccessTokenMock).not.toHaveBeenCalled();
	});

	it('uses the stored token without refreshing when still valid', async () => {
		getZohoTokensMock.mockResolvedValue(tokenRow());
		const { ensureValidZohoToken } = await loadModule();
		const result = await ensureValidZohoToken();
		expect(result?.accessToken).toBe('stored-access');
		expect(refreshAccessTokenMock).not.toHaveBeenCalled();
		expect(upsertZohoTokensMock).not.toHaveBeenCalled();
	});

	it('refreshes, persists, and returns the new token when expired', async () => {
		getZohoTokensMock.mockResolvedValue(tokenRow({ expires_at: PAST }));
		refreshAccessTokenMock.mockResolvedValue({
			access_token: 'fresh-access',
			refresh_token: 'stored-refresh',
			expires_at: Date.now() + 3600 * 1000,
			api_domain: 'https://www.zohoapis.com'
		});
		const { ensureValidZohoToken } = await loadModule();
		const result = await ensureValidZohoToken();

		expect(refreshAccessTokenMock).toHaveBeenCalledWith('stored-refresh');
		expect(result?.accessToken).toBe('fresh-access');
		expect(result?.apiDomain).toBe('https://www.zohoapis.com');
		expect(upsertZohoTokensMock).toHaveBeenCalledTimes(1);
		const upserted = upsertZohoTokensMock.mock.calls[0][0];
		expect(upserted.user_id).toBe('user-123');
		expect(upserted.access_token).toBe('fresh-access');
		expect(upserted.scope).toBe('ZohoCRM.modules.ALL');
		expect(typeof upserted.expires_at).toBe('string');
		expect(Number.isNaN(new Date(upserted.expires_at).getTime())).toBe(false);
	});

	it('falls back to a safe expiry when the refresh returns a bad value', async () => {
		getZohoTokensMock.mockResolvedValue(tokenRow({ expires_at: PAST }));
		refreshAccessTokenMock.mockResolvedValue({
			access_token: 'fresh-access',
			refresh_token: 'stored-refresh',
			expires_at: NaN
		});
		const { ensureValidZohoToken } = await loadModule();
		const result = await ensureValidZohoToken();
		expect(result?.accessToken).toBe('fresh-access');
		const upserted = upsertZohoTokensMock.mock.calls[0][0];
		expect(Number.isNaN(new Date(upserted.expires_at).getTime())).toBe(false);
	});
});

describe('ensureValidZohoTokenByUserId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('resolves the token for a specific user', async () => {
		getZohoTokenByUserIdMock.mockResolvedValue(tokenRow({ user_id: 'mailbox-9' }));
		const { ensureValidZohoTokenByUserId } = await loadModule();
		const result = await ensureValidZohoTokenByUserId('mailbox-9');
		expect(getZohoTokenByUserIdMock).toHaveBeenCalledWith('mailbox-9');
		expect(result?.tokens.user_id).toBe('mailbox-9');
	});

	it('returns null when that user has no token', async () => {
		getZohoTokenByUserIdMock.mockResolvedValue(null);
		const { ensureValidZohoTokenByUserId } = await loadModule();
		expect(await ensureValidZohoTokenByUserId('nobody')).toBeNull();
	});
});
