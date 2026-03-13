import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

interface DealItem {
	id: string;
	deal_name: string;
	stage: string;
	contact_name: string;
}

function extractContactName(contact: unknown): string {
	if (!contact) return '';
	if (typeof contact === 'string') return contact;
	if (typeof contact === 'object' && contact !== null && 'name' in contact) {
		return String((contact as { name: unknown }).name);
	}
	return '';
}

async function fetchDealsByStage(
	accessToken: string,
	stage: string,
	apiDomain?: string
): Promise<DealItem[]> {
	try {
		const encodedStage = encodeURIComponent(stage);
		const result = await zohoApiCall(
			accessToken,
			`/Deals/search?criteria=(Stage:equals:${encodedStage})&fields=Deal_Name,Stage,Contact_Name,Closing_Date&per_page=200`,
			{},
			apiDomain
		);

		const records = result?.data;
		if (!Array.isArray(records)) return [];

		return records.map((d: Record<string, unknown>) => ({
			id: String(d.id),
			deal_name: String(d.Deal_Name || ''),
			stage: String(d.Stage || ''),
			contact_name: extractContactName(d.Contact_Name)
		}));
	} catch {
		// If search endpoint fails, try criteria filter on list endpoint
		try {
			const result = await zohoApiCall(
				accessToken,
				`/Deals?criteria=(Stage:equals:${encodeURIComponent(stage)})&fields=Deal_Name,Stage,Contact_Name,Closing_Date&per_page=200`,
				{},
				apiDomain
			);

			const records = result?.data;
			if (!Array.isArray(records)) return [];

			return records.map((d: Record<string, unknown>) => ({
				id: String(d.id),
				deal_name: String(d.Deal_Name || ''),
				stage: String(d.Stage || ''),
				contact_name: extractContactName(d.Contact_Name)
			}));
		} catch {
			return [];
		}
	}
}

export const GET: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const tokens = await getZohoTokens();
		if (!tokens) {
			return json({ message: 'Zoho not connected' }, { status: 400 });
		}

		let accessToken = tokens.access_token;
		let apiDomain = tokens.api_domain ?? undefined;

		if (new Date(tokens.expires_at) < new Date()) {
			const refreshed = await refreshAccessToken(tokens.refresh_token);
			accessToken = refreshed.access_token;
			apiDomain = refreshed.api_domain || tokens.api_domain || undefined;

			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: refreshed.refresh_token,
				expires_at: new Date(refreshed.expires_at).toISOString(),
				scope: tokens.scope,
				api_domain: apiDomain || null
			});
		}

		// Fetch deals from both stages in parallel
		const [contractSent, projectCreated] = await Promise.all([
			fetchDealsByStage(accessToken, 'Contract Sent', apiDomain),
			fetchDealsByStage(accessToken, 'Project Created', apiDomain)
		]);

		// Merge and deduplicate by id
		const seen = new Set<string>();
		const allDeals: DealItem[] = [];
		for (const deal of [...contractSent, ...projectCreated]) {
			if (!seen.has(deal.id)) {
				seen.add(deal.id);
				allDeals.push(deal);
			}
		}

		// Sort by deal_name
		allDeals.sort((a, b) => a.deal_name.localeCompare(b.deal_name));

		return json({ data: allDeals });
	} catch (err) {
		console.error('GET /api/admin/deals error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch deals';
		return json({ message }, { status: 500 });
	}
};
