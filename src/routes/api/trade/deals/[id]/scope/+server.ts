import { error, json } from '@sveltejs/kit';
import { getTradePartnerDeals } from '$lib/server/auth';
import { getTradeSession, supabase } from '$lib/server/db';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import type { RequestHandler } from './$types';

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) throw error(500, 'Zoho tokens not configured');

	const accessToken = valid.accessToken;
	const apiDomain = valid.apiDomain;

	return { accessToken, apiDomain };
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getTradeSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const tradePartnerId = String(session.trade_partner?.zoho_trade_partner_id || '').trim();
	if (!tradePartnerId) throw error(403, 'No linked trade partner');

	const dealId = String(params.id || '').trim();
	if (!dealId) throw error(400, 'Deal ID required');

	const { accessToken, apiDomain } = await getAccessToken();
	const dealList = await getTradePartnerDeals(accessToken, tradePartnerId, apiDomain);
	const deal = dealList.find((item: any) => String(item?.id || '').trim() === dealId);
	if (!deal) throw error(403, 'Access denied to this project');

	const { data, error: queryError } = await supabase
		.from('scope_tasks')
		.select('trade, document_url')
		.eq('deal_id', dealId)
		.not('document_url', 'is', null)
		.not('document_url', 'eq', '')
		.order('trade', { ascending: true });

	if (queryError) throw error(500, queryError.message);

	return json({
		data: Array.isArray(data)
			? data.map((row: any) => ({
					label: String(row?.trade || '').trim(),
					url: String(row?.document_url || '')
				}))
			: []
	});
};
