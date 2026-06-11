<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	type Books = { invoiced: number; paid: number; balance: number; invoiceCount: number };

	export let data: PageData;

	const usd = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});
	const money = (n: number | null | undefined) =>
		n === null || n === undefined ? '—' : usd.format(n);

	const NONE = '__none__';
	const stageKey = (stage: string | null) => (stage && stage.trim() ? stage : NONE);
	const stageLabel = (key: string) => (key === NONE ? 'No stage' : key);

	$: allRows = data.rows ?? [];
	$: allStages = Array.from(new Set(allRows.map((r) => stageKey(r.stage)))).sort((a, b) =>
		a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)
	);

	// Selected stages — default to Project Created only; fall back to all
	// stages if no deals are in that stage.
	let selected: Set<string> = new Set();
	let initialized = false;
	$: if (!initialized && allStages.length > 0) {
		const projectCreated = allStages.filter(
			(key) => key !== NONE && key.toLowerCase().includes('project created')
		);
		selected = projectCreated.length > 0 ? new Set(projectCreated) : new Set(allStages);
		initialized = true;
	}

	function toggle(key: string) {
		const next = new Set(selected);
		next.has(key) ? next.delete(key) : next.add(key);
		selected = next;
	}
	function selectAll() {
		selected = new Set(allStages);
	}
	function clearAll() {
		selected = new Set();
	}

	$: visibleRows = allRows.filter((r) => selected.has(stageKey(r.stage)));

	// Books data, loaded after render from the API.
	let booksLoading = true;
	let booksWarning = '';
	let booksById = new Map<string, Books | null>();
	let emailById = new Map<string, string | null>();

	$: contractVisible = visibleRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

	// Dedupe Books by customer (email) so a client with multiple visible deals
	// isn't counted more than once.
	$: booksVisible = (() => {
		const seen = new Set<string>();
		let invoiced = 0;
		let paid = 0;
		let balance = 0;
		for (const r of visibleRows) {
			const key = emailById.get(r.id) || `deal:${r.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const b = booksById.get(r.id);
			if (b) {
				invoiced += b.invoiced;
				paid += b.paid;
				balance += b.balance;
			}
		}
		return { invoiced, paid, balance };
	})();

	// Invoice drill-down — click a deal name to expand its invoice list.
	type InvoiceRow = {
		id: string;
		number: string;
		date: string | null;
		dueDate: string | null;
		status: string | null;
		total: number | null;
		balance: number | null;
	};
	let expandedDealId: string | null = null;
	let invoicesByEmail = new Map<string, InvoiceRow[]>();
	let invoiceLoadingEmails = new Set<string>();
	let invoiceErrorByEmail = new Map<string, string>();

	function toggleInvoices(rowId: string) {
		expandedDealId = expandedDealId === rowId ? null : rowId;
	}

	async function loadInvoices(email: string) {
		invoiceLoadingEmails = new Set([...invoiceLoadingEmails, email]);
		try {
			const res = await fetch(
				`/api/designer/financials/invoices?email=${encodeURIComponent(email)}`
			);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.message || `Failed to load invoices (${res.status})`);
			const next = new Map(invoicesByEmail);
			next.set(email, Array.isArray(payload?.invoices) ? payload.invoices : []);
			invoicesByEmail = next;
		} catch (err) {
			const next = new Map(invoiceErrorByEmail);
			next.set(email, err instanceof Error ? err.message : 'Failed to load invoices');
			invoiceErrorByEmail = next;
		} finally {
			const next = new Set(invoiceLoadingEmails);
			next.delete(email);
			invoiceLoadingEmails = next;
		}
	}

	// Fetch when a row is expanded and its Books email is known.
	$: if (expandedDealId && !booksLoading) {
		const email = emailById.get(expandedDealId);
		if (
			email &&
			!invoicesByEmail.has(email) &&
			!invoiceLoadingEmails.has(email) &&
			!invoiceErrorByEmail.has(email)
		) {
			loadInvoices(email);
		}
	}

	const fmtDate = (value: string | null) => {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.valueOf()) ? value : d.toLocaleDateString();
	};

	onMount(async () => {
		try {
			const res = await fetch('/api/designer/financials');
			if (!res.ok) {
				booksWarning = 'Could not load invoice data from Zoho Books.';
				booksLoading = false;
				return;
			}
			const payload = await res.json();
			const books = new Map<string, Books | null>();
			const emails = new Map<string, string | null>();
			for (const row of payload.rows ?? []) {
				books.set(row.id, row.books ?? null);
				emails.set(row.id, row.email ?? null);
			}
			booksById = books;
			emailById = emails;
			booksWarning = payload.warning || '';
			booksLoading = false;
		} catch {
			booksWarning = 'Could not load invoice data from Zoho Books.';
			booksLoading = false;
		}
	});
</script>

<svelte:head>
	<title>Financials · Designer · CPR Portal</title>
</svelte:head>

{#if data.warning}<div class="warning">{data.warning}</div>{/if}
{#if booksWarning}<div class="warning">{booksWarning}</div>{/if}

<div class="filters">
	<div class="filter-head">
		<span class="filter-label">Stages</span>
		<div class="filter-actions">
			<button type="button" class="link" on:click={selectAll}>All</button>
			<button type="button" class="link" on:click={clearAll}>None</button>
		</div>
	</div>
	<div class="chips">
		{#each allStages as key (key)}
			<button
				type="button"
				class="chip"
				class:active={selected.has(key)}
				aria-pressed={selected.has(key)}
				on:click={() => toggle(key)}
			>
				{stageLabel(key)}
			</button>
		{/each}
	</div>
</div>

<div class="summary">
	<div class="stat">
		<span class="stat-label">Contract value</span>
		<span class="stat-value">{usd.format(contractVisible)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Invoiced</span>
		<span class="stat-value">{booksLoading ? '…' : money(booksVisible.invoiced)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Paid</span>
		<span class="stat-value">{booksLoading ? '…' : money(booksVisible.paid)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Outstanding</span>
		<span class="stat-value">{booksLoading ? '…' : money(booksVisible.balance)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Deals shown</span>
		<span class="stat-value">{visibleRows.length}</span>
	</div>
</div>

{#if visibleRows.length === 0}
	<div class="empty">No deals match the selected stages.</div>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Deal</th>
					<th>Client</th>
					<th>Stage</th>
					<th class="num">Contract</th>
					<th class="num">Invoiced</th>
					<th class="num">Paid</th>
					<th class="num">Balance</th>
					<th>Closing</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleRows as row (row.id)}
					{@const books = booksById.get(row.id)}
					{@const rowEmail = emailById.get(row.id)}
					<tr>
						<td class="name">
							<button
								type="button"
								class="name-btn"
								on:click={() => toggleInvoices(row.id)}
								aria-expanded={expandedDealId === row.id}
								title="Show invoice breakdown"
							>
								<span class="caret">{expandedDealId === row.id ? '▾' : '▸'}</span>
								{row.name}
							</button>
						</td>
						<td>{row.contactName ?? '—'}</td>
						<td>{#if row.stage}<span class="badge">{row.stage}</span>{:else}—{/if}</td>
						<td class="num">{money(row.amount)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.invoiced)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.paid)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.balance)}</td>
						<td>{row.closingDate ?? '—'}</td>
					</tr>
					{#if expandedDealId === row.id}
						<tr class="detail-row">
							<td colspan="8">
								{#if booksLoading}
									<p class="detail-muted">Loading…</p>
								{:else if !rowEmail}
									<p class="detail-muted">No Zoho Books customer is linked to this deal.</p>
								{:else if invoiceLoadingEmails.has(rowEmail)}
									<p class="detail-muted">Loading invoices…</p>
								{:else if invoiceErrorByEmail.get(rowEmail)}
									<p class="detail-muted detail-error">{invoiceErrorByEmail.get(rowEmail)}</p>
								{:else}
									{@const invs = invoicesByEmail.get(rowEmail) ?? []}
									{#if invs.length === 0}
										<p class="detail-muted">No invoices found for this client.</p>
									{:else}
										<table class="inv-table">
											<thead>
												<tr>
													<th>Invoice #</th>
													<th>Date</th>
													<th>Due</th>
													<th>Status</th>
													<th class="num">Total</th>
													<th class="num">Balance</th>
												</tr>
											</thead>
											<tbody>
												{#each invs as inv (inv.id)}
													<tr>
														<td>{inv.number || '—'}</td>
														<td>{fmtDate(inv.date)}</td>
														<td>{fmtDate(inv.dueDate)}</td>
														<td class="inv-status">{inv.status || '—'}</td>
														<td class="num">{money(inv.total)}</td>
														<td class="num">{money(inv.balance)}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									{/if}
								{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
	<p class="caption">
		Invoiced / Paid / Balance come from each client's Zoho Books account (customer-level totals,
		not split per deal). Contract value is the deal amount in the CRM.
	</p>
{/if}

<style>
	.filters {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
	}

	.filter-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.6rem;
	}

	.filter-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #6b7280;
		font-weight: 700;
	}

	.filter-actions {
		display: flex;
		gap: 0.75rem;
	}

	.link {
		background: none;
		border: none;
		padding: 0;
		color: #2563eb;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.link:hover {
		text-decoration: underline;
	}

	/* Invoice drill-down */
	.name-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: #1d4ed8;
		cursor: pointer;
		text-align: left;
	}

	.name-btn:hover {
		text-decoration: underline;
	}

	.caret {
		color: #9ca3af;
		font-size: 0.75rem;
	}

	.detail-row td {
		background: #f8fafc;
		padding: 0.75rem 1rem 1rem;
	}

	.detail-muted {
		margin: 0;
		color: #6b7280;
		font-size: 0.88rem;
	}

	.detail-error {
		color: #b91c1c;
	}

	.inv-table {
		width: 100%;
		border-collapse: collapse;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
		font-size: 0.87rem;
	}

	.inv-table th {
		text-align: left;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.inv-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #f3f4f6;
		background: #fff;
	}

	.inv-table tr:last-child td {
		border-bottom: none;
	}

	.inv-table .num {
		text-align: right;
	}

	.inv-status {
		text-transform: capitalize;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #6b7280;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.chip:hover {
		border-color: #9ca3af;
	}

	.chip.active {
		background: #111827;
		color: #fff;
		border-color: #111827;
	}

	.summary {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.stat {
		flex: 1 1 140px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-label {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.stat-value {
		font-size: 1.35rem;
		font-weight: 700;
		color: #0f172a;
	}

	.table-wrap {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.65rem 0.85rem;
		border-bottom: 1px solid #f1f5f9;
		white-space: nowrap;
	}

	th {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #6b7280;
		background: #f8fafc;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	.name {
		font-weight: 600;
		color: #0f172a;
		white-space: normal;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.badge {
		background: #eef2f7;
		color: #1f2937;
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-weight: 600;
		font-size: 0.8rem;
	}

	.caption {
		margin: 0.6rem 0 0;
		font-size: 0.8rem;
		color: #6b7280;
	}

	.warning {
		border: 1px solid #fde68a;
		background: #fffbeb;
		color: #92400e;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
	}
</style>
