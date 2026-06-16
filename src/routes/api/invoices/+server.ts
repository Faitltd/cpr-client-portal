import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import {
	getBooksCustomerByEmail,
	getEstimateById,
	isCountedQuoteStatus,
	listEstimatesForCustomer,
	listInvoicesForCustomer
} from '$lib/server/books';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	try {
		const session = await getSession(sessionToken);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		const valid = await ensureValidZohoToken();
		if (!valid) {
			throw error(500, 'Zoho tokens not configured');
		}

		const accessToken = valid.accessToken;

		const customer = await getBooksCustomerByEmail(accessToken, session.client.email);
		if (!customer) {
			return json({ data: [], quotedTotal: 0 });
		}

		const [invoices, estimates] = await Promise.all([
			listInvoicesForCustomer(accessToken, customer.contact_id),
			listEstimatesForCustomer(accessToken, customer.contact_id).catch(() => [])
		]);

		// Total quoted: accepted or (partially) invoiced Books estimates.
		// Drives the client's Balance (price minus invoiced) on the dashboard.
		const countedEstimates = (Array.isArray(estimates) ? estimates : []).filter((est) =>
			isCountedQuoteStatus(est?.status)
		);
		let quotedTotal = 0;
		for (const est of countedEstimates) {
			const total = Number(est?.total || 0);
			if (!Number.isNaN(total)) quotedTotal += total;
		}

		// Change orders live on the quote as line items named "Change Order #…".
		// Pull them from the counted quotes' details for the dashboard.
		const changeOrderItems: Array<{
			name: string;
			description: string | null;
			total: number;
			quoteNumber: string | null;
			quoteDate: string | null;
		}> = [];
		for (const est of countedEstimates.slice(0, 5)) {
			const estimateId = String(est?.estimate_id ?? '');
			if (!estimateId) continue;
			const detail = await getEstimateById(accessToken, estimateId).catch(() => null);
			const lineItems = Array.isArray(detail?.line_items) ? detail.line_items : [];
			for (const item of lineItems) {
				const name = String(item?.name ?? '');
				if (!/change\s*order/i.test(name)) continue;
				const total = Number(item?.item_total ?? item?.rate ?? 0);
				changeOrderItems.push({
					name,
					description: item?.description ? String(item.description) : null,
					total: Number.isNaN(total) ? 0 : total,
					quoteNumber: detail?.estimate_number ? String(detail.estimate_number) : null,
					quoteDate: detail?.date ? String(detail.date) : null
				});
			}
		}

		return json({ data: invoices, quotedTotal, changeOrderItems });
	} catch (err) {
		console.error('Failed to fetch invoices:', err);
		throw error(500, 'Failed to fetch invoices');
	}
};
