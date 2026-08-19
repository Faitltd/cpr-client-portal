import { json } from '@sveltejs/kit';
import { isNoAdminTokensError, isNotFoundError, requireDesigner } from '$lib/server/designer';
import { getDealTasks } from '$lib/server/pipeline';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.tasks');

const DEAL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export const GET: RequestHandler = async ({ cookies, params }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (typeof dealId !== 'string' || !DEAL_ID_RE.test(dealId)) {
		return json({ message: 'Invalid deal id.' }, { status: 400 });
	}

	try {
		const tasks = await getDealTasks(dealId);
		return json({ tasks });
	} catch (err) {
		if (isNotFoundError(err)) {
			return json({ message: 'Deal not found.' }, { status: 404 });
		}
		if (isNoAdminTokensError(err)) {
			return json(
				{ message: 'Zoho CRM is not connected. An admin must complete OAuth first.' },
				{ status: 503 }
			);
		}
		const message = err instanceof Error ? err.message : 'Unable to load tasks';
		log.error('getDealTasks failed', { dealId, error: message });
		return json({ message }, { status: 502 });
	}
};
