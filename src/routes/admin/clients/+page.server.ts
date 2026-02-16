import { fail, redirect } from '@sveltejs/kit';
import {
	debugTradePartnerRecord,
	isPortalActiveStage,
	listContactsForActiveDeals,
	listContactsForPasswordSeedDeals,
	listTradePartnersWithStats
} from '$lib/server/auth';
import { getProject, isProjectsPortalConfigured, parseZohoProjectIds } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { isValidAdminSession } from '$lib/server/admin';
import {
	clearClients,
	getZohoTokens,
	listClients,
	listTradePartnersForAdmin,
	setClientPassword,
	setTradePartnerPassword,
	upsertClient,
	upsertTradePartner,
	upsertZohoTokens
} from '$lib/server/db';
import { hashPassword } from '$lib/server/password';
import type { Actions, PageServerLoad } from './$types';

const PROJECT_AUDIT_FIELDS = ['Deal_Name', 'Stage', 'Contact_Name', 'Zoho_Projects_ID', 'Modified_Time'].join(',');

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

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) {
		return date.toISOString();
	}
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.toISOString();
		}
	}
	// Short expiry to force a refresh soon if Zoho returned an invalid date.
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function toTenDigitPhone(value: string | null | undefined) {
	if (!value) return null;
	const digits = value.replace(/\D/g, '');
	if (!digits) return null;
	if (digits.length === 11 && digits.startsWith('1')) {
		return digits.slice(1);
	}
	if (digits.length === 10) {
		return digits;
	}
	return null;
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

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const clients = await listClients();
	const tradePartners = await listTradePartnersForAdmin();
	const sorted = [...clients].sort((a, b) => {
		const aName = (a.full_name || a.email || '').toLowerCase();
		const bName = (b.full_name || b.email || '').toLowerCase();
		return aName.localeCompare(bName);
	});
	return { clients: sorted, tradePartners: tradePartners || [] };
};

export const actions: Actions = {
	setPassword: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const clientId = String(form.get('client_id') || '');
		const password = String(form.get('password') || '');

		if (!clientId) {
			return fail(400, { message: 'Select a client.' });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		await setClientPassword(clientId, hashPassword(password));
		return { message: 'Password updated.' };
	},
	setTradePassword: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const tradeId = String(form.get('trade_partner_id') || '');
		const password = String(form.get('password') || '');

		if (!tradeId) {
			return fail(400, { message: 'Select a trade partner.' });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		await setTradePartnerPassword(tradeId, hashPassword(password));

		return { message: 'Trade partner password updated.' };
	},
	sync: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		try {
			const tokens = await getZohoTokens();
			if (!tokens) {
				return fail(500, { message: 'Zoho is not connected yet.' });
			}

			await clearClients();

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

			let synced = 0;
			let errors = 0;
			let passwordSet = 0;
			let missingPhone = 0;
			const activeContacts = await listContactsForActiveDeals(accessToken);
			const seedContacts = await listContactsForPasswordSeedDeals(accessToken);

			const activeEmails = new Set(
				activeContacts.map((contact) => contact.email?.toLowerCase()).filter(Boolean)
			);
			const seedEmails = new Set(
				seedContacts.map((contact) => contact.email?.toLowerCase()).filter(Boolean)
			);

			const contactMap = new Map<string, typeof activeContacts[number]>();
			for (const contact of [...activeContacts, ...seedContacts]) {
				const email = contact.email?.toLowerCase();
				if (!email) continue;
				if (!contactMap.has(email)) {
					contactMap.set(email, contact);
				}
			}

			for (const [email, contact] of contactMap.entries()) {
				const portalActive = activeEmails.has(email);
				try {
					const saved = await upsertClient({ ...contact, portal_active: portalActive });
					synced += 1;
					const phoneDigits = toTenDigitPhone(contact.phone);
					if (phoneDigits) {
						await setClientPassword(saved.id, hashPassword(phoneDigits));
						passwordSet += 1;
					} else {
						missingPhone += 1;
					}
				} catch (err) {
					errors += 1;
					console.error('Failed to sync contact', contact.email, err);
				}
			}

			const message = errors
				? `Synced ${synced} contacts. ${errors} failed. Passwords set: ${passwordSet}. Missing phone: ${missingPhone}.`
				: `Synced ${synced} contacts. Passwords set: ${passwordSet}. Missing phone: ${missingPhone}.`;

			return { message };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error('Client sync failed', err);
			return fail(500, { message: `Client sync failed: ${message}` });
		}
	},
	debugDealStages: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const tokens = await getZohoTokens();
		if (!tokens) {
			return fail(500, { message: 'Zoho is not connected yet.' });
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
		let total = 0;
		let missingStage = 0;
		let missingContact = 0;
		const stageCounts = new Map<string, number>();

		while (more) {
			const response = await zohoApiCall(
				accessToken,
				`/Deals?fields=${encodeURIComponent('Stage,Contact_Name')}&page=${page}&per_page=${perPage}`
			);
			const deals = response.data || [];
			for (const deal of deals) {
				total += 1;
				const stage = typeof deal.Stage === 'string' ? deal.Stage.trim() : '';
				const key = stage || '(missing)';
				if (!stage) missingStage += 1;
				if (!deal.Contact_Name?.id) missingContact += 1;
				stageCounts.set(key, (stageCounts.get(key) || 0) + 1);
			}

			more = Boolean(response.info?.more_records);
			page += 1;
		}

		const topStages = Array.from(stageCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 15)
			.map(([stage, count]) => `${stage}=${count}`)
			.join(', ');

		const message = `Deals scanned: ${total}. Missing stage: ${missingStage}. Missing contact: ${missingContact}. Top stages: ${topStages}`;
		return { message };
	},
		syncTradePartners: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const tokens = await getZohoTokens();
		if (!tokens) {
			return fail(500, { message: 'Zoho is not connected yet.' });
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

		let synced = 0;
		let errors = 0;
		const { partners, stats } = await listTradePartnersWithStats(accessToken);
		for (const partner of partners) {
			try {
				await upsertTradePartner(partner);
				synced += 1;
			} catch (err) {
				errors += 1;
				console.error('Failed to sync trade partner', partner.email, err);
			}
		}

		const totalRecords = stats.reduce((sum, stat) => sum + stat.totalRecords, 0);
		const missingEmail = stats.reduce((sum, stat) => sum + stat.missingEmail, 0);
		const recovered = stats.reduce((sum, stat) => sum + (stat.recovered || 0), 0);
		const moduleSummary =
			stats.length > 1
				? ` Modules: ${stats.map((stat) => `${stat.moduleName}=${stat.totalRecords}`).join(', ')}.`
				: stats.length === 1
					? ` Module: ${stats[0].moduleName}.`
					: '';
		const baseMessage = errors
			? `Synced ${synced} trade partners. ${errors} failed.`
			: `Synced ${synced} trade partners.`;
		const message =
			stats.length > 0
				? `${baseMessage} Zoho returned ${totalRecords} records. Missing email: ${missingEmail}. Recovered: ${recovered}.${moduleSummary}`
				: baseMessage;

			return { message };
		},
		auditProjects: async ({ cookies }) => {
			requireAdmin(cookies.get('admin_session'));

			const tokens = await getZohoTokens();
			if (!tokens) {
				return fail(500, { message: 'Zoho is not connected yet.' });
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
			const sampleMissingDeals: Array<{
				dealId: string;
				dealName: string | null;
				stage: string | null;
				contactName: string | null;
				modifiedTime: string | null;
			}> = [];

			while (more) {
				const response = await zohoApiCall(
					accessToken,
					`/Deals?fields=${encodeURIComponent(PROJECT_AUDIT_FIELDS)}&page=${page}&per_page=${perPage}`
				);
				const deals = Array.isArray(response.data) ? response.data : [];
				scannedDeals += deals.length;

				for (const deal of deals) {
					const stage = typeof deal?.Stage === 'string' ? deal.Stage.trim() : '';
					if (!isPortalActiveStage(stage)) continue;

					activeDeals += 1;
					const stageKey = stage || '(missing)';
					stageCounts.set(stageKey, (stageCounts.get(stageKey) || 0) + 1);

					const parsedProjectIds = parseZohoProjectIds(deal?.Zoho_Projects_ID);
					if (parsedProjectIds.length > 0) {
						for (const projectId of parsedProjectIds) {
							mappedProjectIdSet.add(projectId);
						}
						mappedDeals += 1;
						continue;
					}

					missingDeals += 1;
					if (sampleMissingDeals.length < 25) {
						sampleMissingDeals.push({
							dealId: String(deal?.id || ''),
							dealName:
								typeof deal?.Deal_Name === 'string'
									? deal.Deal_Name
									: getLookupName(deal?.Deal_Name) || null,
							stage: stage || null,
							contactName: getLookupName(deal?.Contact_Name),
							modifiedTime:
								typeof deal?.Modified_Time === 'string' ? deal.Modified_Time : null
						});
					}
				}

				more = Boolean(response.info?.more_records);
				page += 1;
			}

			const allMappedProjectIds = Array.from(mappedProjectIdSet);
			let resolvedProjects = 0;
			let unresolvedProjectIds: string[] = [];
			let sampleProjects: Array<{
				projectId: string;
				name: string | null;
				status: string | null;
				startDate: string | null;
				endDate: string | null;
			}> = [];
			let projectsError: string | null = null;

			if (allMappedProjectIds.length > 0) {
				if (!isProjectsPortalConfigured()) {
					projectsError = 'ZOHO_PROJECTS_PORTAL_ID is not configured.';
				} else {
					const maxProjectLookups = 120;
					const lookupIds = allMappedProjectIds.slice(0, maxProjectLookups);
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
					unresolvedProjectIds = projectResults
						.filter((item) => !item.project)
						.map((item) => item.projectId);

					sampleProjects = resolved.slice(0, 25).map((item) => {
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
			}

			const missingPercent = activeDeals > 0 ? Number(((missingDeals / activeDeals) * 100).toFixed(2)) : 0;
			const topStages = Array.from(stageCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 8)
				.map(([stage, count]) => `${stage}=${count}`);
			const message = `Projects mapping audit: ${mappedDeals}/${activeDeals} active deals mapped. Missing: ${missingDeals} (${missingPercent}%). Resolved projects: ${resolvedProjects}/${allMappedProjectIds.length}.`;

			return {
				message,
				audit: {
					scannedDeals,
					activeDeals,
					mappedDeals,
					missingDeals,
					missingPercent,
					mappedProjectIds: allMappedProjectIds.length,
					resolvedProjects,
					unresolvedProjectIds,
					sampleProjects,
					projectsError,
					topStages,
					sampleMissingDeals
				}
			};
		},
		debugTradePartner: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const zohoId = String(form.get('zoho_trade_partner_id') || '').trim();
		if (!zohoId) {
			return fail(400, { message: 'Enter a Zoho trade partner ID.' });
		}

		const tokens = await getZohoTokens();
		if (!tokens) {
			return fail(500, { message: 'Zoho is not connected yet.' });
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

		const debug = await debugTradePartnerRecord(accessToken, zohoId);
		if (!debug) {
			return { message: `Debug ${zohoId}: no record returned by the API.` };
		}

		const emailValue = debug.email ? debug.email : 'missing';
		const emailFields = debug.emailFields.length ? debug.emailFields.join(', ') : 'none';
		const keys = debug.keys.slice(0, 20).join(', ');
		const message = `Debug ${zohoId} (${debug.moduleName}): email=${emailValue}. Email fields: ${emailFields}. Keys: ${keys}.`;
		return { message };
	}
};
