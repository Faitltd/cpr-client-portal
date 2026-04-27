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
			Stage: 'Project Created',
			File_Upload: [
				{
					id: 'file-1',
					File_Name: 'Kitchen Design.pdf',
					download_url: 'https://download.example/file-1'
				},
				{
					file_id: 'file-2',
					file_name: 'Elevation Set.pdf',
					file_url: 'https://download.example/file-2'
				},
				null,
				{
					id: 'file-3',
					File_Name: 'Broken Link.pdf'
				}
			]
		},
		{
			id: 'project-2',
			Deal_Name: 'Fallback Deal',
			Stage: 'Project Created',
			File_Upload: {
				id: 'fallback-file',
				File_Name: 'Fallback Design.pdf',
				download_url: 'https://download.example/fallback-file'
			}
		}
	]);
	mocks.getDealProjectIdsForLinking.mockImplementation((deal: any) => {
		if (deal?.id === 'deal-1') return ['project-1'];
		return [];
	});
	mocks.getProject.mockImplementation(async (projectId: string) => ({
		project: {
			id: projectId,
			name: `Project ${projectId}`,
			deal_id: 'deal-1'
		}
	}));
	mocks.getAllProjectTasks.mockResolvedValue([{ id: 'task-1', name: 'Install cabinets' }]);
	mocks.getAllProjectActivities.mockResolvedValue([{ id: 'activity-1', description: 'Created' }]);
});

describe('GET /api/trade/projects/:projectId', () => {
	it('returns normalized File_Upload entries as designs for linked projects', async () => {
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
					id: 'file-1',
					name: 'Kitchen Design.pdf',
					url: 'https://download.example/file-1'
				},
				{
					id: 'file-2',
					name: 'Elevation Set.pdf',
					url: 'https://download.example/file-2'
				}
			]
		});
	});

	it('returns normalized File_Upload entries for crm-deal fallback cards', async () => {
		const response = await GET({
			cookies: makeCookies({ trade_session: 'valid-session' }),
			params: { projectId: 'project-2' },
			url: new URL('https://example.test/api/trade/projects/project-2')
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				id: 'project-2',
				deal_id: 'project-2'
			},
			designs: [
				{
					id: 'fallback-file',
					name: 'Fallback Design.pdf',
					url: 'https://download.example/fallback-file'
				}
			],
			tasks: [],
			activities: []
		});
	});
});
