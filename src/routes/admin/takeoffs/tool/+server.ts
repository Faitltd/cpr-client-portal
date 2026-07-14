import { error } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import toolHtml from '$lib/assets/sm-takeoff-estimator.html?raw';
import type { RequestHandler } from './$types';

// Serves the standalone SM Takeoff & Estimate tool. Admin-only — the raw
// HTML lives in $lib/assets so it is never exposed as a public static file.
export const GET: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw error(401, 'Not authenticated');
	}
	return new Response(toolHtml, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};
