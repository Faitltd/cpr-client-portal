import { redirect, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import {
	getOutreachDashboard,
	markContacted,
	unmarkContacted,
	setLeadStatus,
	normalizeView
} from '$lib/server/outreach';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(cookies: import('@sveltejs/kit').Cookies) {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/login');
	}
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	requireAdmin(cookies);
	const view = normalizeView(url.searchParams.get('view'));
	const { leads, lastRun, counts } = await getOutreachDashboard(view);
	return { leads, lastRun, counts, view };
};

async function readIdAndView(request: Request) {
	const form = await request.formData();
	const id = String(form.get('id') ?? '');
	const view = normalizeView(String(form.get('view') ?? 'active'));
	return { id, view };
}

export const actions: Actions = {
	contact: async ({ request, cookies }) => {
		requireAdmin(cookies);
		const { id, view } = await readIdAndView(request);
		if (id) await markContacted(id);
		throw redirect(303, `/admin/outreach?view=${view}`);
	},
	undo: async ({ request, cookies }) => {
		requireAdmin(cookies);
		const { id, view } = await readIdAndView(request);
		if (id) await unmarkContacted(id);
		throw redirect(303, `/admin/outreach?view=${view}`);
	},
	qualify: async ({ request, cookies }) => {
		requireAdmin(cookies);
		const { id, view } = await readIdAndView(request);
		if (id) await setLeadStatus(id, 'qualified');
		throw redirect(303, `/admin/outreach?view=${view}`);
	},
	reject: async ({ request, cookies }) => {
		requireAdmin(cookies);
		const { id, view } = await readIdAndView(request);
		if (id) await setLeadStatus(id, 'rejected');
		throw redirect(303, `/admin/outreach?view=${view}`);
	},
	archive: async ({ request, cookies }) => {
		requireAdmin(cookies);
		const { id, view } = await readIdAndView(request);
		if (id) await setLeadStatus(id, 'archived');
		throw redirect(303, `/admin/outreach?view=${view}`);
	},
	run: async ({ cookies }) => {
		requireAdmin(cookies);
		const url = env.OUTREACH_RUN_URL;
		const secret = env.OUTREACH_RUN_SECRET;
		if (!url || !secret) {
			return fail(500, {
				ok: false,
				runMessage: 'Run isn’t configured yet. Set OUTREACH_RUN_URL and OUTREACH_RUN_SECRET.'
			});
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 90_000);
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${secret}` },
				signal: controller.signal
			});
			if (!res.ok) {
				return fail(502, { ok: false, runMessage: `Agent responded ${res.status}. Check its logs.` });
			}
			return { ok: true, runMessage: 'Search complete. Any new leads are in the list below.' };
		} catch (err) {
			if ((err as Error).name === 'AbortError') {
				return {
					ok: true,
					runMessage: 'Search kicked off — still running. Refresh in a minute to see new leads.'
				};
			}
			return fail(502, { ok: false, runMessage: 'Could not reach the agent.' });
		} finally {
			clearTimeout(timer);
		}
	}
};
