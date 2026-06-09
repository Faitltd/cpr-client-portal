<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	const usd = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});

	$: rows = data.rows ?? [];
</script>

<svelte:head>
	<title>Financials · Designer · CPR Portal</title>
</svelte:head>

{#if data.warning}
	<div class="warning">{data.warning}</div>
{/if}

<div class="summary">
	<div class="stat">
		<span class="stat-label">Total pipeline value</span>
		<span class="stat-value">{usd.format(data.total)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Deals</span>
		<span class="stat-value">{data.count}</span>
	</div>
	<div class="stat">
		<span class="stat-label">With an amount</span>
		<span class="stat-value">{data.valuedCount}</span>
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
					<th class="num">Amount</th>
					<th>Closing</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<td class="name">{row.name}</td>
						<td>{row.contactName ?? '—'}</td>
						<td>{#if row.stage}<span class="badge">{row.stage}</span>{:else}—{/if}</td>
						<td class="num">{row.amount === null ? '—' : usd.format(row.amount)}</td>
						<td>{row.closingDate ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.summary {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.stat {
		flex: 1 1 160px;
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
