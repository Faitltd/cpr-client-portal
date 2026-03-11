import { json } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		return json({ data: context.deals || [] });
	} catch (err) {
		console.error('Failed to fetch projects:', err);
		return json({ error: 'Failed to fetch projects' }, { status: 500 });
	}
};
