import { json } from '@sveltejs/kit';
import { getAllDeals, isNoAdminTokensError, requireDesigner } from '$lib/server/designer';
import { createLogger } from '$lib/server/logger';
import type { ApiErrorResponse, DealsResponse } from '$lib/types/designer';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.deals');

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	try {
		const deals = await getAllDeals();
		const body: DealsResponse = { deals };
		return json(body);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unable to load deals';
		log.error('getAllDeals failed', { error: message });
		if (isNoAdminTokensError(err)) {
			const payload: ApiErrorResponse = {
				message: 'Zoho CRM is not connected. An admin must complete OAuth first.'
			};
			return json(payload, { status: 503 });
		}
		const payload: ApiErrorResponse = { message };
		return json(payload, { status: 502 });
	}
};
