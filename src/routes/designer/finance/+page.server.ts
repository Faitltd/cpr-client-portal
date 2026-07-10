import { requireStaffPage } from '$lib/server/designer';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { listAllCustomerPayments, listAllInvoices } from '$lib/server/books';
import type { PageServerLoad } from './$types';

export type FinanceInvoice = {
	id: string;
	number: string;
	customerName: string;
	date: string | null;
	dueDate: string | null;
	status: string;
	total: number;
	balance: number;
};

export type FinancePayment = {
	id: string;
	customerName: string;
	date: string | null;
	amount: number;
	mode: string | null;
	invoiceNumbers: string | null;
};

const toNumber = (value: unknown): number => {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
};

const toStr = (value: unknown): string => (typeof value === 'string' ? value : '');

const OPEN_STATUSES = new Set(['sent', 'overdue', 'partially_paid', 'unpaid', 'viewed']);

export const load: PageServerLoad = async ({ cookies }) => {
	// Org-wide Books data — finance role (Sean) and admins only.
	await requireStaffPage(cookies, '/designer/finance', ['finance']);

	let invoices: FinanceInvoice[] = [];
	let payments: FinancePayment[] = [];
	let warning = '';

	try {
		const token = await ensureValidZohoToken();
		if (!token) throw new Error('No Zoho admin tokens stored. Complete admin OAuth first.');

		const [rawInvoices, rawPayments] = await Promise.all([
			listAllInvoices(token.accessToken),
			listAllCustomerPayments(token.accessToken)
		]);

		invoices = rawInvoices.map((inv: any) => ({
			id: toStr(inv.invoice_id),
			number: toStr(inv.invoice_number),
			customerName: toStr(inv.customer_name),
			date: toStr(inv.date) || null,
			dueDate: toStr(inv.due_date) || null,
			status: toStr(inv.status).toLowerCase(),
			total: toNumber(inv.total),
			balance: toNumber(inv.balance)
		}));

		payments = rawPayments.map((p: any) => ({
			id: toStr(p.payment_id),
			customerName: toStr(p.customer_name),
			date: toStr(p.date) || null,
			amount: toNumber(p.amount),
			mode: toStr(p.payment_mode) || null,
			invoiceNumbers: toStr(p.invoice_numbers) || null
		}));
	} catch (err) {
		warning = err instanceof Error ? err.message : 'Unable to load Zoho Books data.';
	}

	const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const within30 = (date: string | null) => {
		if (!date) return false;
		const d = new Date(date);
		return !Number.isNaN(d.valueOf()) && d >= cutoff30;
	};

	const openInvoices = invoices.filter((inv) => OPEN_STATUSES.has(inv.status) && inv.balance > 0);
	const summary = {
		outstanding: openInvoices.reduce((sum, inv) => sum + inv.balance, 0),
		overdue: invoices
			.filter((inv) => inv.status === 'overdue')
			.reduce((sum, inv) => sum + inv.balance, 0),
		openCount: openInvoices.length,
		invoiced30: invoices.filter((inv) => within30(inv.date)).reduce((s, inv) => s + inv.total, 0),
		paid30: payments.filter((p) => within30(p.date)).reduce((s, p) => s + p.amount, 0)
	};

	return {
		summary,
		invoices,
		payments: payments.slice(0, 50),
		warning
	};
};
