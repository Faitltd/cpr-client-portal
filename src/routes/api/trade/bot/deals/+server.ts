import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import type { RequestHandler } from './$types';

interface DealItem {
	id: string;
	deal_name: string;
	stage: string;
	contact_name: string;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const access = await getBotAccess(cookies);
	if (!access || (access.role !== 'trade_partner' && access.role !== 'admin')) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	// For trade partners, load only their assigned deals via the trade session.
	// For admin (testing trade view), return their trade-session deals if they
	// have one — otherwise return an empty list and let them pass a dealId
	// explicitly via the chat endpoint.
	const sessionToken = cookies.get('trade_session') ?? '';
	if (!sessionToken && access.role === 'admin') {
		return json({ data: [] });
	}
	const ctx = await loadTradePageContext(sessionToken, { includeDetailFields: false });

	if (ctx.redirectTo) {
		if (access.role === 'admin') return json({ data: [] });
		return json({ message: 'Trade session expired' }, { status: 401 });
	}

	const deals: DealItem[] = (ctx.deals ?? [])
		.map((d: any): DealItem => ({
			id: String(d.id ?? d.deal_id ?? ''),
			deal_name: String(d.Deal_Name ?? d.deal_name ?? '(untitled)'),
			stage: String(d.Stage ?? d.stage ?? ''),
			contact_name: ''
		}))
		.filter((d) => d.id);

	deals.sort((a, b) => a.deal_name.localeCompare(b.deal_name));

	return json({ data: deals });
};
