import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getZohoTokens: vi.fn(),
	upsertZohoTokens: vi.fn(),
	getDealsForClient: vi.fn(),
	getCachedFolder: vi.fn(),
	setCachedFolder: vi.fn(),
	refreshAccessToken: vi.fn(),
	zohoApiCall: vi.fn(),
	extractExternalLinkHash: vi.fn(),
	extractWorkDriveFolderId: vi.fn(),
	listWorkDriveFolder: vi.fn(),
	resolveExternalLink: vi.fn(),
	buildDealFolderCandidates: vi.fn(),
	findBestFolderByName: vi.fn(),
	getWorkDriveApiBase: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
	logError: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getSession: mocks.getSession,
	getZohoTokens: mocks.getZohoTokens,
	upsertZohoTokens: mocks.upsertZohoTokens
}));

vi.mock('$lib/server/projects', () => ({
	getDealsForClient: mocks.getDealsForClient
}));

vi.mock('$lib/server/folder-cache', () => ({
	getCachedFolder: mocks.getCachedFolder,
	setCachedFolder: mocks.setCachedFolder
}));

vi.mock('$lib/server/logger', () => ({
	createLogger: () => ({
		info: mocks.logInfo,
		debug: mocks.logDebug,
		error: mocks.logError
	})
}));

vi.mock('$lib/server/zoho', () => ({
	refreshAccessToken: mocks.refreshAccessToken,
	zohoApiCall: mocks.zohoApiCall
}));

vi.mock('$lib/server/workdrive', () => ({
	extractExternalLinkHash: mocks.extractExternalLinkHash,
	extractWorkDriveFolderId: mocks.extractWorkDriveFolderId,
	listWorkDriveFolder: mocks.listWorkDriveFolder,
	resolveExternalLink: mocks.resolveExternalLink,
	buildDealFolderCandidates: mocks.buildDealFolderCandidates,
	findBestFolderByName: mocks.findBestFolderByName,
	getWorkDriveApiBase: mocks.getWorkDriveApiBase
}));

import { GET } from './+server';

function makeCookies(values: Record<string, string | undefined>) {
	return {
		get(name: string) {
			return values[name];
		}
	};
}

describe('GET /api/project/:id/designs', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		mocks.getSession.mockResolvedValue({
			client: {
				zoho_contact_id: 'contact-1',
				email: 'client@example.com'
			}
		});
		mocks.getZohoTokens.mockResolvedValue({
			user_id: 'user-1',
			access_token: 'access-token',
			refresh_token: 'refresh-token',
			expires_at: new Date(Date.now() + 60_000).toISOString(),
			scope: 'scope'
		});
		mocks.getDealsForClient.mockResolvedValue([{ id: 'deal-1' }]);
		mocks.getCachedFolder.mockResolvedValue(null);
		mocks.setCachedFolder.mockResolvedValue(undefined);
		mocks.extractExternalLinkHash.mockReturnValue('');
		mocks.extractWorkDriveFolderId.mockImplementation((value: unknown) =>
			typeof value === 'string' && value.trim() ? value.trim() : ''
		);
		mocks.resolveExternalLink.mockResolvedValue(null);
		mocks.buildDealFolderCandidates.mockReturnValue([]);
		mocks.findBestFolderByName.mockReturnValue(null);
		mocks.getWorkDriveApiBase.mockReturnValue('https://workdrive.example/api/v1');
		mocks.zohoApiCall.mockResolvedValue({
			data: [
				{
					id: 'deal-1',
					Deal_Name: 'Kitchen Remodel',
					Client_Portal_Folder: 'project-folder',
					External_Link: '',
					Designs: ''
				}
			]
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.endsWith('/files/project-folder')) {
					return {
						ok: true,
						json: async () => ({
							data: {
								attributes: {
									parent_id: 'project-parent'
								}
							}
						})
					} as Response;
				}
				return {
					ok: false,
					json: async () => null,
					text: async () => ''
				} as Response;
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('drills into a matched planning container to find the leaf designs folder', async () => {
		mocks.listWorkDriveFolder
			.mockResolvedValueOnce([
				{ id: 'container-folder', name: 'Design & Planning', type: 'folder' },
				{ id: 'photos-folder', name: 'Photos', type: 'folder' }
			])
			.mockResolvedValueOnce([
				{ id: 'leaf-designs', name: 'Designs', type: 'folder' },
				{ id: 'notes-folder', name: 'Notes', type: 'folder' }
			]);

		const response = await GET({
			cookies: makeCookies({ portal_session: 'valid-session' }),
			params: { id: 'deal-1' }
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			url: 'https://workdrive.zoho.com/folder/leaf-designs',
			folderId: 'leaf-designs'
		});
		expect(mocks.listWorkDriveFolder).toHaveBeenNthCalledWith(
			1,
			'access-token',
			'project-folder',
			undefined
		);
		expect(mocks.listWorkDriveFolder).toHaveBeenNthCalledWith(
			2,
			'access-token',
			'container-folder',
			undefined
		);
	});

	it('applies the same drill-down after finding a planning container in the parent folder', async () => {
		mocks.listWorkDriveFolder
			.mockResolvedValueOnce([{ id: 'photos-folder', name: 'Photos', type: 'folder' }])
			.mockResolvedValueOnce([
				{ id: 'parent-container', name: 'Design and Planning', type: 'folder' },
				{ id: 'permits-folder', name: 'Permits', type: 'folder' }
			])
			.mockResolvedValueOnce([
				{ id: 'parent-leaf-designs', name: 'Designs', type: 'folder' }
			]);

		const response = await GET({
			cookies: makeCookies({ portal_session: 'valid-session' }),
			params: { id: 'deal-1' }
		} as any);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			url: 'https://workdrive.zoho.com/folder/parent-leaf-designs',
			folderId: 'parent-leaf-designs'
		});
		expect(mocks.listWorkDriveFolder).toHaveBeenNthCalledWith(
			2,
			'access-token',
			'project-parent',
			undefined
		);
		expect(mocks.listWorkDriveFolder).toHaveBeenNthCalledWith(
			3,
			'access-token',
			'parent-container',
			undefined
		);
	});
});
