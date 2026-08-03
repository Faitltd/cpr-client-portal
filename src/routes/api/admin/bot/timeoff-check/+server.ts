import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { getApprovedTimeOff } from '$lib/server/connecteam';
import type { RequestHandler } from './$types';

/**
 * Diagnostic: shows exactly what the scheduling block sees for time off.
 * GET /api/admin/bot/timeoff-check
 */
export const GET: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Admin access required' }, { status: 403 });
	}
	const keySet = Boolean(env.CONNECTEAM_API_KEY);
	const keyPreview = keySet
		? `${env.CONNECTEAM_API_KEY!.slice(0, 4)}…${env.CONNECTEAM_API_KEY!.slice(-4)} (${env.CONNECTEAM_API_KEY!.length} chars)`
		: null;

	const today = new Date();
	const start = new Date(today);
	start.setDate(today.getDate() - 7);
	const end = new Date(today);
	end.setDate(today.getDate() + 14);
	const d = (x: Date) =>
		`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

	try {
		const timeOff = await getApprovedTimeOff(d(start), d(end));
		return json({
			keySet,
			keyPreview,
			window: { start: d(start), end: d(end) },
			result: timeOff === null ? 'NULL (key not set at runtime)' : timeOff
		});
	} catch (err) {
		return json({
			keySet,
			keyPreview,
			window: { start: d(start), end: d(end) },
			error: err instanceof Error ? err.message : String(err)
		});
	}
};
