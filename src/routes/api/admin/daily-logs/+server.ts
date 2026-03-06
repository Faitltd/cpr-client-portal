import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getDailyLogsForDeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const dealId = url.searchParams.get('dealId');
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });

	try {
		const data = await getDailyLogsForDeal(dealId);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch daily logs';
		return json({ message }, { status: 500 });
	}
};
