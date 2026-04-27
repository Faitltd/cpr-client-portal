import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getTradeSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn(),
	getTradePartnerDeals: vi.fn(),
	refreshAccessToken: vi.fn(),
	getDealProjectIdsForLinking: vi.fn(),
	getProject: vi.fn(),
	getAllProjectTasks: vi.fn(),
	getAllProjectActivities: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getTradeSession: mocks.getTradeSession,
	getZohoTokens: mocks.getZohoTokens,
	upsertZohoTokens: mocks.upsertZohoTokens
}));

vi.mock('$lib/server/auth', () => ({
	getTradePartnerDeals: mocks.getTradePartnerDeals
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: mocks.refreshAccessToken
}));

vi.mock('$lib/server/projects', () => ({
	getDealProjectIdsForLinking: mocks.getDealProjectIdsForLinking,
	getProject: mocks.getProject,
	getAllProjectTasks: mocks.getAllProjectTasks,
	getAllProjectActivities: mocks.getAllProjectActivities
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

	mocks.getTradeSession.mockResolvedValue({
		trade_partner: {
			zoho_trade_partner_id: 'tp-1'
		}
	});
	mocks.getZohoTokens.mockResolvedValue({
		user_id: 'user-1',
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		expires_at: new Date(Date.now() + 60_000).toISOString(),
		scope: 'scope'
	});
	mocks.getTradePartnerDeals.mockResolvedValue([
		{
			id: 'deal-1',
			Deal_Name: 'Kitchen Remodel',
			Stage: 'Project Created'
		}
	]);
	mocks.getDealProjectIdsForLinking.mockReturnValue(['project-1', 'project-2']);
	mocks.getProject.mockImplementation(async (projectId: string) => ({
		project: {
			id: projectId,
			name: `Project ${projectId}`,
			deal_id: 'deal-1'
		}
	}));
	mocks.getAllProjectTasks.mockResolvedValue([{ id: 'task-1', name: 'Install cabinets' }]);
	mocks.getAllProjectActivities.mockResolvedValue([{ id: 'activity-1', description: 'Created' }]);

	vi.stubGlobal('fetch', vi.fn());
});

describe('GET /api/trade/projects/:projectId', () => {
	it('returns filtered CRM deal attachments as designs', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				data: [
					{
						id: 'attachment-1',
						File_Name: 'Kitchen Design.pdf',
						file_type: 'pdf',
						download_url: 'https://download.example/attachment-1'
					},
					{
						id: 'attachment-2',
						File_Name: 'drawing-sheet.dwg',
						file_type: 'dwg'
					},
					{
						id: 'attachment-3',
						File_Name: 'site-photo.jpg',
						file_type: 'jpg'
					}
				]
			})
		} as any);

		const response = await GET({
			cookies: makeCookies({ trade_session: 'valid-session' }),
			params: { projectId: 'project-1' },
			url: new URL('https://example.test/api/trade/projects/project-1')
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				id: 'project-1',
				deal_id: 'deal-1'
			},
			tasks: [{ id: 'task-1', name: 'Install cabinets' }],
			activities: [{ id: 'activity-1', description: 'Created' }],
			designs: [
				{
					id: 'attachment-1',
					name: 'Kitchen Design.pdf',
					url: 'https://download.example/attachment-1'
				},
				{
					id: 'attachment-2',
					name: 'drawing-sheet.dwg',
					url: 'https://www.zohoapis.com/crm/v2/Deals/deal-1/Attachments/attachment-2'
				}
			]
		});

		expect(fetch).toHaveBeenCalledWith(
			'https://www.zohoapis.com/crm/v2/Deals/deal-1/Attachments',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token'
				})
			})
		);
	});

	it('returns an empty designs list when attachments cannot be read', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 403,
			text: vi.fn().mockResolvedValue('Forbidden')
		} as any);

		const response = await GET({
			cookies: makeCookies({ trade_session: 'valid-session' }),
			params: { projectId: 'project-2' },
			url: new URL('https://example.test/api/trade/projects/project-2')
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				id: 'project-2',
				deal_id: 'deal-1'
			},
			designs: [],
			tasks: [{ id: 'task-1', name: 'Install cabinets' }],
			activities: [{ id: 'activity-1', description: 'Created' }]
		});
	});
});
