import { redirect } from '@sveltejs/kit';
import { getDesignerDashboardContext, requireStaffPage } from '$lib/server/designer';
import type { PageServerLoad } from './$types';

type FinancialRow = {
	id: string;
	name: string;
	stage: string | null;
	contactName: string | null;
	amount: number | null;
	closingDate: string | null;
};

function toAmount(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
	return Number.isFinite(n) ? n : null;
}

function toDateString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

export const load: PageServerLoad = async ({ cookies }) => {
	// Deal financials are for ops and finance roles (and admins).
	await requireStaffPage(cookies, '/designer/financials', ['ops', 'finance']);

	const context = await getDesignerDashboardContext(cookies.get('portal_session'), 'financials');
	if (!context) {
		throw redirect(302, '/auth/portal?next=/designer/financials');
	}

	const rows: FinancialRow[] = context.deals.map((deal) => {
		const fields = (deal.fields ?? {}) as Record<string, unknown>;
		return {
			id: deal.id,
			name: deal.name,
			stage: deal.stage,
			contactName: deal.contactName,
			amount: toAmount(fields.Amount),
			closingDate: toDateString(fields.Closing_Date)
		};
	});

	rows.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));

	const total = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
	const valuedCount = rows.filter((row) => row.amount !== null).length;

	return { rows, total, valuedCount, count: rows.length, warning: context.warning };
};
