import { redirect } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getOutreachDashboard, normalizeView } from '$lib/server/outreach';
import { titleCaseAddress } from '$lib/addressCase';
import type { RequestHandler } from './$types';

function csvCell(v: string): string {
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Split an assessor-format owner name ("LAST First Middle ...") into first/last.
 * Best-effort: first token is the last name, second token the first name — which
 * covers the primary owner on these Arapahoe County records.
 */
function splitName(owner: string | null): { first: string; last: string } {
	const parts = (owner ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { first: '', last: '' };
	if (parts.length === 1) return { first: '', last: parts[0] };
	return { last: parts[0], first: parts[1] };
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		throw redirect(302, '/admin/login');
	}

	const view = normalizeView(url.searchParams.get('view'));
	const { leads } = await getOutreachDashboard(view, 1000);

	const rows = [['First Name', 'Last Name', 'Address']];
	for (const l of leads) {
		const { first, last } = splitName(l.owner_name);
		rows.push([first, last, titleCaseAddress(l.address)]);
	}

	const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
	const date = new Date().toISOString().slice(0, 10);

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="outreach-${view}-${date}.csv"`
		}
	});
};
