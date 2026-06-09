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

	$: rows = data.rows ?? [];

	let booksLoading = true;
	let booksWarning = '';
	let booksById = new Map<string, Books | null>();
	let bookTotals: { invoiced: number; paid: number; balance: number } | null = null;

	const money = (n: number | null | undefined) =>
		n === null || n === undefined ? '—' : usd.format(n);

	onMount(async () => {
		try {
			const res = await fetch('/api/designer/financials');
			if (!res.ok) {
				booksWarning = 'Could not load invoice data from Zoho Books.';
				booksLoading = false;
				return;
			}
			const payload = await res.json();
			const map = new Map<string, Books | null>();
			for (const row of payload.rows ?? []) {
				map.set(row.id, row.books ?? null);
			}
			booksById = map;
			bookTotals = payload.totals ?? null;
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

{#if data.warning}
	<div class="warning">{data.warning}</div>
{/if}
{#if booksWarning}
	<div class="warning">{booksWarning}</div>
{/if}

<div class="summary">
	<div class="stat">
		<span class="stat-label">Contract value</span>
		<span class="stat-value">{usd.format(data.total)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Invoiced</span>
		<span class="stat-value">{booksLoading ? '…' : money(bookTotals?.invoiced ?? 0)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Paid</span>
		<span class="stat-value">{booksLoading ? '…' : money(bookTotals?.paid ?? 0)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Outstanding</span>
		<span class="stat-value">{booksLoading ? '…' : money(bookTotals?.balance ?? 0)}</span>
	</div>
</div>

{#if rows.length === 0}
	<div class="empty">No deals to show.</div>
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
				{#each rows as row (row.id)}
					{@const books = booksById.get(row.id)}
					<tr>
						<td class="name">{row.name}</td>
						<td>{row.contactName ?? '—'}</td>
						<td>{#if row.stage}<span class="badge">{row.stage}</span>{:else}—{/if}</td>
						<td class="num">{money(row.amount)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.invoiced)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.paid)}</td>
						<td class="num">{booksLoading ? '…' : money(books?.balance)}</td>
						<td>{row.closingDate ?? '—'}</td>
					</tr>
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
	.summary {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.stat {
		flex: 1 1 150px;
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
