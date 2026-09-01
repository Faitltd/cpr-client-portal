import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getOutreachDashboard, normalizeView } from '$lib/server/outreach';
import { titleCaseAddress } from '$lib/addressCase';
import type { RequestHandler } from './$types';

function csvCell(v: string): string {
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Best-effort split of a messy assessor owner name into first/last for a mail
 * merge. Two-owner records become "First1 & First2" (e.g. "John & Amanda").
 * Handles the reliable signals — an explicit "and"/"&", and a repeated surname
 * (which marks a couple in either "Last First" or "First Last" order). Couples
 * with two different surnames fall back to the primary owner's first name.
 */
function firstWord(s: string): string {
	return s.trim().split(/\s+/)[0] ?? '';
}

function splitName(owner: string | null): { first: string; last: string } {
	const raw = (owner ?? '').trim();
	if (!raw) return { first: '', last: '' };
	const tokens = raw.split(/\s+/);

	// A. Explicit connector: "Marc And Jennifer Davis", "Jeffrey M & Heather D Ronsse"
	if (/\s+(?:&|and)\s+/i.test(raw)) {
		const [left, right] = raw.split(/\s+(?:&|and)\s+/i);
		return { first: `${firstWord(left)} & ${firstWord(right)}`.trim(), last: tokens[tokens.length - 1] };
	}

	// B. Repeated surname => a couple. Works for "Last F1 .. Last F2 .." (surname
	// leads) and "F1 .. Last F2 .. Last" (surname trails).
	const lower = tokens.map((t) => t.toLowerCase());
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].length < 3) continue;
		const j = lower.indexOf(lower[i], i + 1);
		if (j <= i) continue;
		if (i === 0 && tokens[1] && tokens[j + 1]) {
			return { first: `${tokens[1]} & ${tokens[j + 1]}`, last: tokens[0] };
		}
		if (j === tokens.length - 1 && tokens[0] && tokens[i + 1]) {
			return { first: `${tokens[0]} & ${tokens[i + 1]}`, last: tokens[j] };
		}
	}

	// C. Single owner / unparseable: assessor default is "Last First [Middle]".
	if (tokens.length === 1) return { first: '', last: tokens[0] };
	return { first: tokens[1], last: tokens[0] };
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/login');
	}

	const view = normalizeView(url.searchParams.get('view'));
	const uncontactedOnly = url.searchParams.get('uncontacted') === '1';
	const { leads } = await getOutreachDashboard(view, 1000);
	const selected = uncontactedOnly ? leads.filter((l) => (l.contacted_count ?? 0) === 0) : leads;

	const rows = [['First Name', 'Last Name', 'Address']];
	for (const l of selected) {
		const { first, last } = splitName(l.owner_name);
		rows.push([first, last, titleCaseAddress(l.address)]);
	}

	const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
	const date = new Date().toISOString().slice(0, 10);
	const label = uncontactedOnly ? `${view}-uncontacted` : view;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="outreach-${label}-${date}.csv"`
		}
	});
};
