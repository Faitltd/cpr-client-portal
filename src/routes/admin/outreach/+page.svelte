<script lang="ts">
	import { titleCaseAddress } from '$lib/addressCase';

	export let data;

	$: leads = data.leads ?? [];
	$: lastRun = data.lastRun;
	$: counts = data.counts ?? { active: 0, rejected: 0, archived: 0, all: 0 };
	$: view = data.view ?? 'active';

	const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
	const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

	const VIEWS: { key: string; label: string }[] = [
		{ key: 'active', label: 'Active' },
		{ key: 'rejected', label: 'Rejected' },
		{ key: 'archived', label: 'Archived' },
		{ key: 'all', label: 'All' }
	];
	const countFor = (k: string) => (counts as Record<string, number>)[k] ?? 0;
</script>

<svelte:head>
	<title>Outreach · CPR Admin</title>
</svelte:head>

<section class="outreach">
	<header class="head">
		<h1>Outreach</h1>
		<span class="count">{leads.length} shown</span>
		<a class="download" href={`/admin/outreach/export?view=${view}`} data-sveltekit-reload>
			Download CSV
		</a>
	</header>

	<nav class="filters" aria-label="Lead views">
		{#each VIEWS as v (v.key)}
			<a class="filter" class:active={view === v.key} href={`/admin/outreach?view=${v.key}`}>
				{v.label} <span class="n">{countFor(v.key)}</span>
			</a>
		{/each}
	</nav>

	{#if lastRun}
		<p class="run">
			Last run {fmtDateTime(lastRun.started_at)} — fetched {lastRun.fetched}, new {lastRun.new_leads},
			qualified {lastRun.qualified}, needs review {lastRun.needs_review}{#if lastRun.error}<span class="err"> · error: {lastRun.error}</span>{/if}
		</p>
	{:else}
		<p class="run">No runs recorded yet.</p>
	{/if}

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">Score</th>
					<th>Owner &amp; reason</th>
					<th>Address</th>
					<th>Status</th>
					<th class="num">Contacted</th>
					<th>Last</th>
					<th class="act-col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each leads as l (l.id)}
					<tr class:done={l.contacted_count > 0}>
						<td class="num">{l.score ?? '—'}</td>
						<td class="owner">
							<div class="name">{l.owner_name ?? '—'}</div>
							{#if l.score_reason}<div class="reason">{l.score_reason}</div>{/if}
						</td>
						<td class="addr">{titleCaseAddress(l.address) || '—'}</td>
						<td><span class="status status-{l.status}">{l.status}</span></td>
						<td class="num">{l.contacted_count || '—'}</td>
						<td>{fmtDate(l.last_contacted_at)}</td>
						<td class="actions">
							{#if l.contacted_count > 0}
								<form method="POST" action="?/undo">
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="view" value={view} />
									<button class="ghost" title="Undo last touch">↺ contacted</button>
								</form>
							{:else}
								<form method="POST" action="?/contact">
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="view" value={view} />
									<button class="ok">Mark contacted</button>
								</form>
							{/if}

							{#if l.status !== 'qualified'}
								<form method="POST" action="?/qualify">
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="view" value={view} />
									<button>Qualify</button>
								</form>
							{/if}
							{#if l.status !== 'rejected'}
								<form method="POST" action="?/reject">
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="view" value={view} />
									<button>Reject</button>
								</form>
							{/if}
							{#if l.status !== 'archived'}
								<form method="POST" action="?/archive">
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="view" value={view} />
									<button class="ghost">Archive</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="empty">No leads in this view.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.outreach {
		width: 100%;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	h1 {
		font-size: 1.4rem;
		font-weight: 800;
		color: #111827;
		margin: 0;
	}
	.count {
		font-size: 0.85rem;
		font-weight: 600;
		color: #92400e;
		background: #fff7ed;
		border: 1px solid #fed7aa;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
	}
	.download {
		margin-left: auto;
		background: #166534;
		color: #fff;
		border-radius: 8px;
		padding: 0.4rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.download:hover {
		background: #14532d;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	.filter {
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 600;
		color: #334155;
		background: #eef2f7;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid transparent;
	}
	.filter:hover {
		background: #dbe3ee;
	}
	.filter.active {
		background: #92400e;
		color: #fff;
		border-color: #92400e;
	}
	.filter .n {
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}

	.run {
		color: #555;
		font-size: 0.9rem;
		margin: 0 0 1rem;
	}
	.err {
		color: #c00;
	}

	.table-wrap {
		width: 100%;
		overflow-x: auto;
		border: 1px solid #e5e7eb;
		border-radius: 0.6rem;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid #f0f0f0;
		vertical-align: top;
	}
	thead th {
		background: #f8fafc;
		color: #334155;
		font-weight: 700;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}
	tbody tr:hover {
		background: #fcfcfd;
	}
	tr.done td {
		color: #6b7280;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.owner {
		min-width: 220px;
	}
	.owner .name {
		font-weight: 600;
		color: #111827;
	}
	.owner .reason {
		color: #6b7280;
		font-size: 0.8rem;
		margin-top: 0.15rem;
		max-width: 340px;
	}
	.addr {
		min-width: 200px;
		color: #555;
	}

	.status {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		background: #eef2f7;
		color: #334155;
		text-transform: capitalize;
		white-space: nowrap;
	}
	.status-qualified {
		background: #fff7ed;
		color: #92400e;
	}
	.status-needs_review {
		background: #eff6ff;
		color: #1e40af;
	}
	.status-approved {
		background: #ecfdf5;
		color: #065f46;
	}
	.status-rejected {
		background: #f3f4f6;
		color: #6b7280;
	}
	.status-archived {
		background: #f3f4f6;
		color: #9ca3af;
	}

	.act-col {
		width: 1%;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		justify-content: flex-end;
	}
	.actions form {
		margin: 0;
	}
	button {
		cursor: pointer;
		border-radius: 7px;
		border: 1px solid #d1d5db;
		padding: 0.28rem 0.55rem;
		font: inherit;
		font-size: 0.8rem;
		background: #fff;
		color: #374151;
		white-space: nowrap;
	}
	button:hover {
		background: #f9fafb;
	}
	.ok {
		background: #92400e;
		color: #fff;
		border-color: #92400e;
	}
	.ok:hover {
		background: #7c2d12;
	}
	.ghost {
		color: #6b7280;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		padding: 1.5rem;
	}
</style>
