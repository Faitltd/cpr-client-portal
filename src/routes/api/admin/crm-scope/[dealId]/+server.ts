import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
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
		const valid = await ensureValidZohoToken();
		if (!valid) {
			return json({ message: 'Zoho not connected' }, { status: 400 });
		}

		const accessToken = valid.accessToken;
		const apiDomain = valid.apiDomain;

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
