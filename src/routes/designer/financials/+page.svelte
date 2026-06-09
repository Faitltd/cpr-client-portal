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

	// Selected stages — start with all enabled once stages are known.
	let selected: Set<string> = new Set();
	let initialized = false;
	$: if (!initialized && allStages.length > 0) {
		selected = new Set(allStages);
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
