import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn(),
	getProjectLinksForClient: vi.fn(),
	getProject: vi.fn(),
	getAllProjectTasks: vi.fn(),
	getAllProjectActivities: vi.fn(),
	parseZohoProjectIds: vi.fn(),
	isValidAdminSession: vi.fn(),
	isPortalActiveStage: vi.fn(),
	refreshAccessToken: vi.fn(),
	zohoApiCall: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getSession: mocks.getSession,
	getZohoTokens: mocks.getZohoTokens,
	upsertZohoTokens: mocks.upsertZohoTokens
}));

vi.mock('$lib/server/projects', () => ({
	getProjectLinksForClient: mocks.getProjectLinksForClient,
	getProject: mocks.getProject,
	getAllProjectTasks: mocks.getAllProjectTasks,
	getAllProjectActivities: mocks.getAllProjectActivities,
	parseZohoProjectIds: mocks.parseZohoProjectIds
}));

vi.mock('$lib/server/admin', () => ({
	isValidAdminSession: mocks.isValidAdminSession
}));

vi.mock('$lib/server/auth', () => ({
	isPortalActiveStage: mocks.isPortalActiveStage
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: mocks.refreshAccessToken,
	zohoApiCall: mocks.zohoApiCall
}));

import { GET as getZprojectDetail } from './[projectId]/+server';
import { GET as getZprojectsAudit } from './audit/+server';

function makeCookies(values: Record<string, string | undefined>) {
	return {
		get(name: string) {
			return values[name];
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSession.mockResolvedValue(null);
	mocks.getZohoTokens.mockResolvedValue(null);
	mocks.getProjectLinksForClient.mockResolvedValue([]);
	mocks.getProject.mockResolvedValue({ project: { id: 'p-1', task_count: 0 } });
	mocks.getAllProjectTasks.mockResolvedValue([]);
	mocks.getAllProjectActivities.mockResolvedValue([]);
	mocks.parseZohoProjectIds.mockReturnValue([]);
	mocks.isValidAdminSession.mockReturnValue(true);
	mocks.isPortalActiveStage.mockReturnValue(true);
	mocks.refreshAccessToken.mockResolvedValue({
		access_token: 'refreshed-token',
		refresh_token: 'refresh-token',
		expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
	});
	mocks.zohoApiCall.mockResolvedValue({ data: [] });
});

describe('zprojects auth guards', () => {
	it('returns 401 when /api/zprojects/:projectId has no portal session', async () => {
		await expect(
			getZprojectDetail({
				cookies: makeCookies({}),
				params: { projectId: 'p-1' }
			} as any)
		).rejects.toMatchObject({ status: 401 });

		expect(mocks.getSession).not.toHaveBeenCalled();
	});

	it('returns 403 when /api/zprojects/:projectId is not linked to the client', async () => {
		mocks.getSession.mockResolvedValue({
			client: {
				zoho_contact_id: 'contact-1',
				email: 'client@example.com'
			}
		});
		mocks.getProjectLinksForClient.mockResolvedValue([
			{
				projectId: 'different-project',
				dealId: 'deal-1',
				dealName: 'Deal 1',
				stage: 'Project Created',
				modifiedTime: null
			}
		]);

		await expect(
			getZprojectDetail({
				cookies: makeCookies({ portal_session: 'portal-session-token' }),
				params: { projectId: 'p-1' }
			} as any)
		).rejects.toMatchObject({ status: 403 });

		expect(mocks.getProject).not.toHaveBeenCalled();
	});

	it('returns 401 when /api/zprojects/audit is called without admin session', async () => {
		mocks.isValidAdminSession.mockReturnValue(false);

		await expect(
			getZprojectsAudit({
				cookies: makeCookies({})
			} as any)
		).rejects.toMatchObject({ status: 401 });

		expect(mocks.getZohoTokens).not.toHaveBeenCalled();
	});
});
