import { fail, redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { listShiftsForRange, listFeeds, addFeed, deleteFeed } from '$lib/server/connecteam';
import type { Actions, PageServerLoad } from './$types';

const TZ = 'America/Denver';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

const denverDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

function addDays(ymd: string, n: number): string {
	const base = new Date(ymd + 'T12:00:00Z');
	return new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
}

function mondayOf(ymd: string): string {
	const dow = new Date(ymd + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
	return addDays(ymd, -((dow + 6) % 7));
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	requireAdmin(cookies.get('admin_session'));

	const weekParam = url.searchParams.get('week') || '';
	const personFilter = url.searchParams.get('person') || '';
	const todayYmd = denverDate(new Date());
	const monday = /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? mondayOf(weekParam) : mondayOf(todayYmd);

	const weekDays = Array.from({ length: 7 }, (_, i) => {
		const date = addDays(monday, i);
		const dt = new Date(date + 'T12:00:00Z');
		return {
			date,
			weekday: dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
			md: dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }),
			isToday: date === todayYmd
		};
	});

	// Padded UTC window; exact day bucketing happens in the view by Denver date.
	const startISO = new Date(addDays(monday, -1) + 'T00:00:00Z').toISOString();
	const endISO = new Date(addDays(monday, 8) + 'T00:00:00Z').toISOString();

	const [allShifts, feeds] = await Promise.all([
		listShiftsForRange(startISO, endISO),
		listFeeds()
	]);

	const allPeople = Array.from(
		new Set(
			[...feeds.map((f) => f.label), ...allShifts.map((s) => s.person)].filter(
				(x): x is string => Boolean(x)
			)
		)
	).sort((a, b) => a.localeCompare(b));

	const people = personFilter ? allPeople.filter((p) => p === personFilter) : allPeople;
	const shifts = personFilter ? allShifts.filter((s) => s.person === personFilter) : allShifts;

	return {
		weekStart: monday,
		weekLabel: `${weekDays[0].md} – ${weekDays[6].md}`,
		prevWeek: addDays(monday, -7),
		nextWeek: addDays(monday, 7),
		thisWeek: mondayOf(todayYmd),
		weekDays,
		people,
		allPeople,
		personFilter,
		shifts,
		feeds
	};
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
