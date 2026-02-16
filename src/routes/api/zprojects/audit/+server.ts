import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminSession } from '$lib/server/admin';
import { isPortalActiveStage } from '$lib/server/auth';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { parseZohoProjectIds } from '$lib/server/projects';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

const AUDIT_DEAL_FIELDS = ['Deal_Name', 'Stage', 'Contact_Name', 'Zoho_Projects_ID', 'Modified_Time'].join(',');

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

	return json({
		summary: {
			scannedDeals,
			activeDeals,
			mappedDeals,
			missingDeals,
			missingPercent: activeDeals > 0 ? Number(((missingDeals / activeDeals) * 100).toFixed(2)) : 0,
			uniqueContactsMissing: missingByContact.size
		},
		stages,
		sampleMissingDeals
	});
};

