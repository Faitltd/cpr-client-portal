import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getClientDashboardContext: vi.fn()
}));

vi.mock('$lib/server/client-dashboard', () => ({
	getClientDashboardContext: mocks.getClientDashboardContext
}));

import { GET } from './+server';

function makeCookies(values: Record<string, string | undefined>) {
	return {
		get(name: string) {
			return values[name];
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getClientDashboardContext.mockResolvedValue(null);
});

describe('GET /api/projects', () => {
	it('returns 401 when the portal session is invalid', async () => {
		const response = await GET({
			cookies: makeCookies({ portal_session: 'invalid-session' })
		} as any);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
		expect(mocks.getClientDashboardContext).toHaveBeenCalledWith('invalid-session');
	});

	it('returns resolved client deals from the shared dashboard context', async () => {
		mocks.getClientDashboardContext.mockResolvedValue({
			session: {
				client: {
					zoho_contact_id: 'stale-contact-id',
					email: 'client@example.com'
				}
			},
			deals: [
				{ id: 'deal-1', Deal_Name: 'Primary Remodel' },
				{ id: 'deal-2', Deal_Name: 'Guest Bath' }
			]
		});

		const response = await GET({
			cookies: makeCookies({ portal_session: 'valid-session' })
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			data: [
				{ id: 'deal-1', Deal_Name: 'Primary Remodel' },
				{ id: 'deal-2', Deal_Name: 'Guest Bath' }
			]
		});
		expect(mocks.getClientDashboardContext).toHaveBeenCalledWith('valid-session');
	});
});
