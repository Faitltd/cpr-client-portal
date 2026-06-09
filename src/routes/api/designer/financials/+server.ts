import { json } from '@sveltejs/kit';
import {
	getDealsForFinancials,
	getDealsFinancials,
	isNoAdminTokensError,
	requireDesigner
} from '$lib/server/designer';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.financials');

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	try {
		const deals = await getDealsForFinancials();
		const financials = await getDealsFinancials(deals);
		return json(financials);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unable to load financials';
		log.error('financials failed', { error: message });
		if (isNoAdminTokensError(err)) {
			return json(
				{ message: 'Zoho CRM is not connected. An admin must complete OAuth first.' },
				{ status: 503 }
			);
		}
		return json({ message }, { status: 502 });
	}
};
