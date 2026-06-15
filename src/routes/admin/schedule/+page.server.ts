import { fail, redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import {
	listUpcomingShifts,
	listFeeds,
	addFeed,
	deleteFeed
} from '$lib/server/connecteam';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const [shifts, feeds] = await Promise.all([listUpcomingShifts(), listFeeds()]);
	return { shifts, feeds };
};

export const actions: Actions = {
	addFeed: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const label = String(form.get('label') || '').trim();
		const icsUrl = String(form.get('ics_url') || '').trim();
		if (!/^https?:\/\/\S+/i.test(icsUrl)) {
			return fail(400, { message: 'Enter a valid http(s) calendar feed URL.' });
		}
		try {
			await addFeed(label, icsUrl);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Add failed.';
			return fail(400, {
				message: /duplicate|unique/i.test(message) ? 'That feed URL is already added.' : message
			});
		}
		return { message: `Added ${label || 'feed'}. Click “Sync now” to pull it in.` };
	},
	deleteFeed: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const id = String(form.get('id') || '');
		if (!id) return fail(400, { message: 'Missing feed id.' });
		try {
			await deleteFeed(id);
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Delete failed.' });
		}
		return { message: 'Feed removed.' };
	}
};
