<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	const usd = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});
	const money = (n: number | null | undefined) =>
		n === null || n === undefined ? '—' : usd.format(n);

	const fmtDate = (value: string | null) => {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.valueOf()) ? value : d.toLocaleDateString();
	};

	type StatusFilter = 'open' | 'overdue' | 'paid' | 'all';
	let statusFilter: StatusFilter = 'open';
	let view: 'invoices' | 'payments' = 'invoices';

	const OPEN = new Set(['sent', 'overdue', 'partially_paid', 'unpaid', 'viewed']);

	$: invoices = data.invoices ?? [];
	$: visibleInvoices = invoices.filter((inv) => {
		if (statusFilter === 'all') return true;
		if (statusFilter === 'open') return OPEN.has(inv.status) && inv.balance > 0;
		if (statusFilter === 'overdue') return inv.status === 'overdue';
		return inv.status === 'paid';
	});

	const statusClass = (status: string) =>
		status === 'overdue'
			? 'st-overdue'
			: status === 'paid'
				? 'st-paid'
				: OPEN.has(status)
					? 'st-open'
					: 'st-other';
</script>

<svelte:head>
	<title>Finance · CPR Portal</title>
</svelte:head>

{#if data.warning}<div class="warning">{data.warning}</div>{/if}

<div class="summary">
	<div class="stat">
		<span class="stat-label">Outstanding (AR)</span>
		<span class="stat-value">{money(data.summary.outstanding)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Overdue</span>
		<span class="stat-value overdue">{money(data.summary.overdue)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Open invoices</span>
		<span class="stat-value">{data.summary.openCount}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Invoiced (30d)</span>
		<span class="stat-value">{money(data.summary.invoiced30)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Collected (30d)</span>
		<span class="stat-value">{money(data.summary.paid30)}</span>
	</div>
</div>

<div class="controls">
	<div class="chips" role="tablist" aria-label="View">
		<button
			type="button"
			class="chip"
			class:active={view === 'invoices'}
			on:click={() => (view = 'invoices')}>Invoices</button
		>
		<button
			type="button"
			class="chip"
			class:active={view === 'payments'}
			on:click={() => (view = 'payments')}>Recent Payments</button
		>
	</div>
	{#if view === 'invoices'}
		<div class="chips" aria-label="Invoice status filter">
			{#each [['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']] as [key, label] (key)}
				<button
					type="button"
					class="chip"
					class:active={statusFilter === key}
					on:click={() => (statusFilter = key as StatusFilter)}>{label}</button
				>
			{/each}
		</div>
	{/if}
</div>

{#if view === 'invoices'}
	{#if visibleInvoices.length === 0}
		<div class="empty">No invoices match this filter.</div>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Invoice #</th>
						<th>Client</th>
						<th>Date</th>
						<th>Due</th>
						<th>Status</th>
						<th class="num">Total</th>
						<th class="num">Balance</th>
					</tr>
				</thead>
				<tbody>
					{#each visibleInvoices as inv (inv.id)}
						<tr>
							<td class="name">{inv.number || '—'}</td>
							<td>{inv.customerName || '—'}</td>
							<td>{fmtDate(inv.date)}</td>
							<td>{fmtDate(inv.dueDate)}</td>
							<td><span class="badge {statusClass(inv.status)}">{inv.status || '—'}</span></td>
							<td class="num">{money(inv.total)}</td>
							<td class="num">{money(inv.balance)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="caption">{visibleInvoices.length} invoices · data from Zoho Books.</p>
	{/if}
{:else if data.payments.length === 0}
	<div class="empty">No payments found.</div>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Date</th>
					<th>Client</th>
					<th>Invoice(s)</th>
					<th>Method</th>
					<th class="num">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each data.payments as p (p.id)}
					<tr>
						<td>{fmtDate(p.date)}</td>
						<td class="name">{p.customerName || '—'}</td>
						<td>{p.invoiceNumbers || '—'}</td>
						<td class="mode">{p.mode || '—'}</td>
						<td class="num">{money(p.amount)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="caption">Latest {data.payments.length} payments · data from Zoho Books.</p>
{/if}

<style>
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

	.stat-value.overdue {
		color: #b91c1c;
	}

	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
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
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.mode {
		text-transform: capitalize;
	}

	.badge {
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-weight: 600;
		font-size: 0.8rem;
		text-transform: capitalize;
	}

	.st-open {
		background: #eff6ff;
		color: #1d4ed8;
	}

	.st-overdue {
		background: #fef2f2;
		color: #b91c1c;
	}

	.st-paid {
		background: #f0fdf4;
		color: #15803d;
	}

	.st-other {
		background: #eef2f7;
		color: #1f2937;
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
