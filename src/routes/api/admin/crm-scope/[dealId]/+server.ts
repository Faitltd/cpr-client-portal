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

export const GET: RequestHandler = async ({ params, cookies }) => {
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

		const result = await zohoApiCall(
			accessToken,
			`/Deals/${params.dealId}`,
			{ method: 'GET' },
			apiDomain
		);

		const deal = result?.data?.[0];
		if (!deal) {
			return json({ message: 'Deal not found' }, { status: 404 });
		}

		// Extract key fields + all text fields for scope discovery
		const dealName = deal.Deal_Name || deal.deal_name || '';
		const stage = deal.Stage || '';
		const contactName = deal.Contact_Name?.name || deal.Contact_Name || '';

		// Return all fields so the frontend can display text fields
		return json({
			data: {
				deal_name: dealName,
				stage,
				contact_name: contactName,
				all_fields: deal
			}
		});
	} catch (err) {
		console.error('GET /api/admin/crm-scope/[dealId] error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch deal from CRM';
		return json({ message }, { status: 500 });
	}
};
