import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	zohoBooksApiCall,
	getBooksCustomerByEmail,
	listInvoicesForCustomer
} from '$lib/server/books';
import { chunkText, embed } from './embeddings';

const PAGE_LIMIT = 200;
const DEFAULT_BACKFILL_DAYS = Number(env.BOT_BOOKS_BACKFILL_DAYS ?? '365');

type BooksSource = 'zoho_books_invoice' | 'zoho_books_estimate' | 'zoho_books_payment';

export interface BooksSyncResult {
	dealId: string;
	customerEmail: string | null;
	customerId: string | null;
	invoices: TypeSyncResult;
	estimates: TypeSyncResult;
	payments: TypeSyncResult;
}

export interface TypeSyncResult {
	source: BooksSource;
	processed: number;
	inserted: number;
	skipped: number;
	error?: string;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
}

interface DealForBooks {
	contactId: string | null;
	contactEmail: string | null;
	dealName: string | null;
}

async function fetchDealForBooks(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<DealForBooks> {
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,Contact_Name,Email`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const dealName = typeof rec.Deal_Name === 'string' ? rec.Deal_Name : null;
	const contactRef = rec.Contact_Name;
	const contactId =
		contactRef && typeof contactRef === 'object' && 'id' in contactRef
			? String((contactRef as any).id)
			: null;

	let contactEmail = typeof rec.Email === 'string' ? rec.Email : null;
	if (!contactEmail && contactId) {
		try {
			const cRes = await zohoApiCall(
				accessToken,
				`/Contacts/${encodeURIComponent(contactId)}?fields=Email`,
				{},
				apiDomain
			);
			const cRec = cRes?.data?.[0] ?? {};
			if (typeof cRec.Email === 'string') contactEmail = cRec.Email;
		} catch {
			/* ignore */
		}
	}

	return { contactId, contactEmail, dealName };
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

function fmtAmount(n: any, currency = 'USD'): string {
	const v = Number(n);
	if (!Number.isFinite(v)) return String(n ?? '');
	return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
}

function renderInvoice(inv: any): { subject: string; body: string; sourceId: string; occurredAt: string } {
	const lines: string[] = [];
	const num = inv.invoice_number ?? inv.number ?? inv.invoice_id ?? '';
	const status = inv.status ?? 'unknown';
	const date = inv.date ?? inv.invoice_date ?? '';
	const dueDate = inv.due_date ?? '';
	const total = fmtAmount(inv.total, inv.currency_code);
	const balance = fmtAmount(inv.balance, inv.currency_code);
	const customer = inv.customer_name ?? '';
	lines.push(`Invoice ${num} for ${customer}`);
	lines.push(`Status: ${status} · Date: ${date}${dueDate ? ` · Due: ${dueDate}` : ''}`);
	lines.push(`Total: ${total} · Balance: ${balance}`);
	if (Array.isArray(inv.line_items) && inv.line_items.length > 0) {
		lines.push('Line items:');
		for (const li of inv.line_items.slice(0, 50)) {
			const name = li.name ?? li.item_name ?? li.description ?? 'item';
			const qty = li.quantity ?? '';
			const rate = li.rate != null ? fmtAmount(li.rate, inv.currency_code) : '';
			const amount = li.item_total != null ? fmtAmount(li.item_total, inv.currency_code) : '';
			lines.push(`  · ${name} — qty ${qty} @ ${rate} = ${amount}`);
		}
	}
	if (inv.notes) lines.push(`Notes: ${String(inv.notes).slice(0, 1000)}`);
	const body = lines.join('\n');
	const sourceId = String(inv.invoice_id ?? num);
	const occurredAt = new Date(date || inv.created_time || Date.now()).toISOString();
	return { subject: `Invoice ${num} (${status})`, body, sourceId, occurredAt };
}

function renderEstimate(est: any): { subject: string; body: string; sourceId: string; occurredAt: string } {
	const lines: string[] = [];
	const num = est.estimate_number ?? est.number ?? est.estimate_id ?? '';
	const status = est.status ?? 'unknown';
	const date = est.date ?? '';
	const total = fmtAmount(est.total, est.currency_code);
	const customer = est.customer_name ?? '';
	lines.push(`Estimate ${num} for ${customer}`);
	lines.push(`Status: ${status} · Date: ${date}`);
	lines.push(`Total: ${total}`);
	if (Array.isArray(est.line_items) && est.line_items.length > 0) {
		lines.push('Line items:');
		for (const li of est.line_items.slice(0, 50)) {
			const name = li.name ?? li.description ?? 'item';
			const qty = li.quantity ?? '';
			const rate = li.rate != null ? fmtAmount(li.rate, est.currency_code) : '';
			const amount = li.item_total != null ? fmtAmount(li.item_total, est.currency_code) : '';
			lines.push(`  · ${name} — qty ${qty} @ ${rate} = ${amount}`);
		}
	}
	if (est.notes) lines.push(`Notes: ${String(est.notes).slice(0, 1000)}`);
	const body = lines.join('\n');
	const sourceId = String(est.estimate_id ?? num);
	const occurredAt = new Date(date || est.created_time || Date.now()).toISOString();
	return { subject: `Estimate ${num} (${status})`, body, sourceId, occurredAt };
}

function renderPayment(pay: any): { subject: string; body: string; sourceId: string; occurredAt: string } {
	const lines: string[] = [];
	const num = pay.payment_number ?? pay.payment_id ?? '';
	const date = pay.date ?? pay.payment_date ?? '';
	const amount = fmtAmount(pay.amount, pay.currency_code);
	const mode = pay.payment_mode ?? '';
	const customer = pay.customer_name ?? '';
	const ref = pay.reference_number ?? '';
	lines.push(`Customer payment ${num} from ${customer}`);
	lines.push(`Date: ${date} · Amount: ${amount}${mode ? ` · Mode: ${mode}` : ''}`);
	if (ref) lines.push(`Reference: ${ref}`);
	if (Array.isArray(pay.invoices)) {
		const ids = pay.invoices.map((x: any) => x.invoice_number ?? x.invoice_id).filter(Boolean);
		if (ids.length) lines.push(`Applied to invoices: ${ids.join(', ')}`);
	}
	if (pay.description) lines.push(`Notes: ${String(pay.description).slice(0, 1000)}`);
	const body = lines.join('\n');
	const sourceId = String(pay.payment_id ?? num);
	const occurredAt = new Date(date || pay.created_time || Date.now()).toISOString();
	return { subject: `Payment ${num}`, body, sourceId, occurredAt };
}

async function ingestRendered(
	dealId: string,
	source: BooksSource,
	author: string | null,
	rec: { subject: string; body: string; sourceId: string; occurredAt: string; metadata?: any }
): Promise<'inserted' | 'skipped'> {
	const docRow = {
		deal_id: dealId,
		source,
		source_id: rec.sourceId,
		source_url: null,
		author,
		occurred_at: rec.occurredAt,
		subject: rec.subject,
		body: rec.body,
		metadata: rec.metadata ?? {},
		hash: hashBody(rec.body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', rec.sourceId)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(`${rec.subject}\n${rec.body}`, 1500, 200);
	if (chunks.length === 0) return 'inserted';
	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

async function getEstimateDetail(accessToken: string, id: string): Promise<any | null> {
	const orgId = env.ZOHO_BOOKS_ORG_ID || '';
	try {
		const res: any = await zohoBooksApiCall(
			accessToken,
			`/estimates/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(orgId)}`
		);
		return res?.estimate ?? null;
	} catch {
		return null;
	}
}

async function getInvoiceDetail(accessToken: string, id: string): Promise<any | null> {
	const orgId = env.ZOHO_BOOKS_ORG_ID || '';
	try {
		const res: any = await zohoBooksApiCall(
			accessToken,
			`/invoices/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(orgId)}`
		);
		return res?.invoice ?? null;
	} catch {
		return null;
	}
}

async function getPaymentDetail(accessToken: string, id: string): Promise<any | null> {
	const orgId = env.ZOHO_BOOKS_ORG_ID || '';
	try {
		const res: any = await zohoBooksApiCall(
			accessToken,
			`/customerpayments/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(orgId)}`
		);
		return res?.payment ?? null;
	} catch {
		return null;
	}
}

async function listAllInvoices(
	accessToken: string,
	customerId: string,
	dealId: string
): Promise<any[]> {
	// Always re-fetch invoice details. CPR updates invoices regularly
	// (status, amounts, line items) and we need the latest state. The hash
	// check downstream still skips Postgres writes when nothing changed.
	const list = await listInvoicesForCustomer(accessToken, customerId).then((r: any) => r?.invoices ?? []);
	const detailed: any[] = [];
	for (const inv of list) {
		const id = inv.invoice_id ?? inv.id;
		if (!id) continue;
		const detail = await getInvoiceDetail(accessToken, String(id));
		detailed.push(detail ? { ...inv, ...detail } : inv);
	}
	return detailed;
}

async function alreadyIngested(source: string, sourceId: string): Promise<boolean> {
	const { data } = await supabase
		.from('bot_documents')
		.select('id')
		.eq('source', source)
		.eq('source_id', sourceId)
		.maybeSingle();
	return !!data;
}

async function listAllEstimates(
	accessToken: string,
	customerId: string,
	dealId: string
): Promise<any[]> {
	// Always re-fetch estimate details. Estimates get revised mid-project
	// (Estimate Revision Needed, Estimate Review Needed stages). Hash check
	// downstream still skips Postgres writes when nothing changed.
	const orgId = env.ZOHO_BOOKS_ORG_ID || '';
	const summaries: any[] = [];
	let page = 1;
	while (page < 20) {
		const res: any = await zohoBooksApiCall(
			accessToken,
			`/estimates?organization_id=${encodeURIComponent(orgId)}&customer_id=${encodeURIComponent(customerId)}&page=${page}&per_page=${PAGE_LIMIT}`
		);
		const batch: any[] = res?.estimates ?? [];
		summaries.push(...batch);
		if (batch.length < PAGE_LIMIT) break;
		page += 1;
	}
	const detailed: any[] = [];
	for (const est of summaries) {
		const id = est.estimate_id ?? est.id;
		if (!id) continue;
		const detail = await getEstimateDetail(accessToken, String(id));
		detailed.push(detail ? { ...est, ...detail } : est);
	}
	return detailed;
}

async function listAllPayments(
	accessToken: string,
	customerId: string,
	dealId: string
): Promise<any[]> {
	const orgId = env.ZOHO_BOOKS_ORG_ID || '';
	const summaries: any[] = [];
	let page = 1;
	while (page < 20) {
		const res: any = await zohoBooksApiCall(
			accessToken,
			`/customerpayments?organization_id=${encodeURIComponent(orgId)}&customer_id=${encodeURIComponent(customerId)}&page=${page}&per_page=${PAGE_LIMIT}`
		);
		const batch: any[] = res?.customerpayments ?? [];
		summaries.push(...batch);
		if (batch.length < PAGE_LIMIT) break;
		page += 1;
	}
	const detailed: any[] = [];
	for (const pay of summaries) {
		const id = pay.payment_id ?? pay.id;
		if (!id) continue;
		if (await alreadyIngested('zoho_books_payment', String(id))) {
			detailed.push(pay);
			continue;
		}
		const detail = await getPaymentDetail(accessToken, String(id));
		detailed.push(detail ? { ...pay, ...detail } : pay);
	}
	return detailed;
}

function withinBackfillWindow(occurredAt: string): boolean {
	const ms = Date.parse(occurredAt);
	if (!Number.isFinite(ms)) return true;
	return ms >= Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000;
}

export async function syncBooksForDeal(dealId: string): Promise<BooksSyncResult> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const deal = await fetchDealForBooks(accessToken, apiDomain, dealId);

	const result: BooksSyncResult = {
		dealId,
		customerEmail: deal.contactEmail,
		customerId: null,
		invoices: { source: 'zoho_books_invoice', processed: 0, inserted: 0, skipped: 0 },
		estimates: { source: 'zoho_books_estimate', processed: 0, inserted: 0, skipped: 0 },
		payments: { source: 'zoho_books_payment', processed: 0, inserted: 0, skipped: 0 }
	};

	if (!deal.contactEmail) {
		result.invoices.error = 'no contact email on Deal';
		result.estimates.error = 'no contact email on Deal';
		result.payments.error = 'no contact email on Deal';
		return result;
	}

	let customer: any;
	try {
		customer = await getBooksCustomerByEmail(accessToken, deal.contactEmail);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'lookup failed';
		result.invoices.error = msg;
		result.estimates.error = msg;
		result.payments.error = msg;
		return result;
	}
	if (!customer) {
		const msg = `no Books customer with email ${deal.contactEmail}`;
		result.invoices.error = msg;
		result.estimates.error = msg;
		result.payments.error = msg;
		return result;
	}
	const customerId = String(customer.contact_id ?? customer.id ?? '');
	result.customerId = customerId;
	const customerName = customer.contact_name ?? customer.company_name ?? null;

	// INVOICES
	try {
		const invoices = await listAllInvoices(accessToken, customerId, dealId);
		for (const inv of invoices) {
			const rec = renderInvoice(inv);
			if (!withinBackfillWindow(rec.occurredAt)) continue;
			result.invoices.processed += 1;
			try {
				const status = await ingestRendered(dealId, 'zoho_books_invoice', customerName, {
					...rec,
					metadata: { customer_id: customerId, invoice_id: inv.invoice_id }
				});
				if (status === 'inserted') result.invoices.inserted += 1;
				else result.invoices.skipped += 1;
			} catch (err) {
				result.invoices.skipped += 1;
				console.warn('[bot/ingest-books] invoice failed:', err instanceof Error ? err.message : err);
			}
		}
	} catch (err) {
		result.invoices.error = err instanceof Error ? err.message : 'invoices fetch failed';
	}

	// ESTIMATES
	try {
		const estimates = await listAllEstimates(accessToken, customerId, dealId);
		for (const est of estimates) {
			const rec = renderEstimate(est);
			if (!withinBackfillWindow(rec.occurredAt)) continue;
			result.estimates.processed += 1;
			try {
				const status = await ingestRendered(dealId, 'zoho_books_estimate', customerName, {
					...rec,
					metadata: { customer_id: customerId, estimate_id: est.estimate_id }
				});
				if (status === 'inserted') result.estimates.inserted += 1;
				else result.estimates.skipped += 1;
			} catch (err) {
				result.estimates.skipped += 1;
				console.warn('[bot/ingest-books] estimate failed:', err instanceof Error ? err.message : err);
			}
		}
	} catch (err) {
		result.estimates.error = err instanceof Error ? err.message : 'estimates fetch failed';
	}

	// PAYMENTS
	try {
		const payments = await listAllPayments(accessToken, customerId, dealId);
		for (const pay of payments) {
			const rec = renderPayment(pay);
			if (!withinBackfillWindow(rec.occurredAt)) continue;
			result.payments.processed += 1;
			try {
				const status = await ingestRendered(dealId, 'zoho_books_payment', customerName, {
					...rec,
					metadata: { customer_id: customerId, payment_id: pay.payment_id }
				});
				if (status === 'inserted') result.payments.inserted += 1;
				else result.payments.skipped += 1;
			} catch (err) {
				result.payments.skipped += 1;
				console.warn('[bot/ingest-books] payment failed:', err instanceof Error ? err.message : err);
			}
		}
	} catch (err) {
		result.payments.error = err instanceof Error ? err.message : 'payments fetch failed';
	}

	return result;
}
