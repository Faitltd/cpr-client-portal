import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminSession } from '$lib/server/admin';
import { isPortalActiveStage } from '$lib/server/auth';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getProject, parseZohoProjectIds } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const AUDIT_DEAL_FIELDS = ['Deal_Name', 'Stage', 'Contact_Name', 'Zoho_Projects_ID', 'Modified_Time'].join(',');

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(limit, items.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function getLookupName(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const candidate = record.name ?? record.display_value ?? record.displayValue ?? null;
	if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	return null;
}

function normalizeProjectResponse(payload: any) {
	if (!payload) return null;
	if (payload.project && typeof payload.project === 'object') return payload.project;
	if (Array.isArray(payload.projects) && payload.projects[0]) return payload.projects[0];
	return payload;
}

export const GET: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw error(401, 'Admin only');
	}

	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	const perPage = 200;
	let page = 1;
	let more = true;

	let scannedDeals = 0;
	let activeDeals = 0;
	let mappedDeals = 0;
	let missingDeals = 0;
	const stageCounts = new Map<string, number>();
	const mappedProjectIdSet = new Set<string>();
	const missingByContact = new Map<string, number>();
	const sampleMissingDeals: Array<{
		dealId: string;
		dealName: string | null;
		stage: string | null;
		contactId: string | null;
		contactName: string | null;
		lastModified: string | null;
	}> = [];

	while (more) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent(AUDIT_DEAL_FIELDS)}&page=${page}&per_page=${perPage}`
		);
		const deals = Array.isArray(response.data) ? response.data : [];
		scannedDeals += deals.length;

		for (const deal of deals) {
			const stage = typeof deal?.Stage === 'string' ? deal.Stage.trim() : '';
			if (!isPortalActiveStage(stage)) continue;

			activeDeals += 1;
			const stageKey = stage || '(missing)';
			stageCounts.set(stageKey, (stageCounts.get(stageKey) || 0) + 1);

			const ids = parseZohoProjectIds(deal?.Zoho_Projects_ID);
			if (ids.length > 0) {
				for (const projectId of ids) {
					mappedProjectIdSet.add(projectId);
				}
				mappedDeals += 1;
				continue;
			}

			missingDeals += 1;
			const contactId = deal?.Contact_Name?.id ? String(deal.Contact_Name.id) : null;
			if (contactId) {
				missingByContact.set(contactId, (missingByContact.get(contactId) || 0) + 1);
			}

			if (sampleMissingDeals.length < 100) {
				sampleMissingDeals.push({
					dealId: String(deal?.id || ''),
					dealName:
						typeof deal?.Deal_Name === 'string'
							? deal.Deal_Name
							: getLookupName(deal?.Deal_Name) || null,
					stage: stage || null,
					contactId,
					contactName: getLookupName(deal?.Contact_Name),
					lastModified:
						typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null
				});
			}
		}

		more = Boolean(response.info?.more_records);
		page += 1;
	}

	const stages = Array.from(stageCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([stage, count]) => ({ stage, count }));

	const mappedProjectIds = Array.from(mappedProjectIdSet);
	let resolvedProjects = 0;
	let unresolvedProjectIds: string[] = [];
	let projectsError: string | null = null;
	let sampleProjects: Array<{
		projectId: string;
		name: string | null;
		status: string | null;
		startDate: string | null;
		endDate: string | null;
	}> = [];

	if (mappedProjectIds.length > 0) {
		const maxProjectLookups = 120;
		const lookupIds = mappedProjectIds.slice(0, maxProjectLookups);
		const projectResults = await mapWithConcurrency(lookupIds, 3, async (projectId) => {
			try {
				const response = await getProject(projectId);
				const project = normalizeProjectResponse(response);
				return { projectId, project, error: null as string | null };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { projectId, project: null, error: message };
			}
		});

		const resolved = projectResults.filter((item) => item.project && !item.error);
		resolvedProjects = resolved.length;
		unresolvedProjectIds = projectResults.filter((item) => !item.project).map((item) => item.projectId);
		if (resolvedProjects === 0) {
			projectsError = projectResults.find((item) => item.error)?.error || null;
		}

		sampleProjects = resolved.slice(0, 30).map((item) => {
			const project = item.project as any;
			return {
				projectId: item.projectId,
				name:
					typeof project?.name === 'string'
						? project.name
						: typeof project?.project_name === 'string'
							? project.project_name
							: null,
				status:
					typeof project?.status === 'string'
						? project.status
						: typeof project?.project_status === 'string'
							? project.project_status
							: null,
				startDate:
					typeof project?.start_date === 'string'
						? project.start_date
						: typeof project?.start_date_string === 'string'
							? project.start_date_string
							: null,
				endDate:
					typeof project?.end_date === 'string'
						? project.end_date
						: typeof project?.end_date_string === 'string'
							? project.end_date_string
							: null
			};
		});
	}

	return json({
		summary: {
			scannedDeals,
			activeDeals,
			mappedDeals,
			missingDeals,
			missingPercent: activeDeals > 0 ? Number(((missingDeals / activeDeals) * 100).toFixed(2)) : 0,
			uniqueContactsMissing: missingByContact.size,
			mappedProjectIds: mappedProjectIds.length,
			resolvedProjects
		},
		stages,
		projects: {
			mappedProjectIds,
			resolvedProjects,
			unresolvedProjectIds,
			sampleProjects,
			projectsError
		},
		sampleMissingDeals
	});
};
