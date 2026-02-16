import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidAdminSession } from '$lib/server/admin';
import { listPortals } from '$lib/server/projects';

// GET /api/zprojects/portals
// Admin-only: discover available Zoho Projects portals so you can set ZOHO_PROJECTS_PORTAL_ID.
export const GET: RequestHandler = async ({ cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw error(401, 'Admin only');
	}

	try {
		const portals = await listPortals();
		return json(portals);
	} catch (err) {
		console.error('Failed to list Zoho Projects portals:', err);
		throw error(500, 'Failed to list portals');
	}
};

