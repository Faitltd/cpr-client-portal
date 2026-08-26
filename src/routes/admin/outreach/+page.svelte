<script lang="ts">
	export let data;

	$: leads = data.leads ?? [];
	$: lastRun = data.lastRun;
	$: totalLeads = data.totalLeads ?? leads.length;

	const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
	const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
</script>

<svelte:head>
	<title>Outreach · CPR Admin</title>
</svelte:head>

<section class="outreach">
	<header class="head">
		<h1>Outreach</h1>
		<span class="count">{totalLeads} lead{totalLeads === 1 ? '' : 's'}</span>
	</header>

	{#if lastRun}
		<p class="run">
			Last run {fmtDateTime(lastRun.started_at)} — fetched {lastRun.fetched},
			new {lastRun.new_leads}, qualified {lastRun.qualified}, needs review {lastRun.needs_review}{#if lastRun.finished_at}, finished {fmtDateTime(lastRun.finished_at)}{/if}{#if lastRun.error}<span class="err"> · error: {lastRun.error}</span>{/if}
		</p>
	{:else}
		<p class="run">No runs recorded yet.</p>
	{/if}

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th class="num">Score</th>
					<th>Owner</th>
					<th>Address</th>
					<th>Status</th>
					<th class="num">Contacted</th>
					<th>Last contacted</th>
					<th>Added</th>
				</tr>
			</thead>
			<tbody>
				{#each leads as l (l.id)}
					<tr>
						<td class="num">{l.score ?? '—'}</td>
						<td>{l.owner_name ?? '—'}</td>
						<td>{l.address ?? '—'}</td>
						<td><span class="status status-{l.status}">{l.status}</span></td>
						<td class="num">{l.contacted_count}</td>
						<td>{fmtDateTime(l.last_contacted_at)}</td>
						<td>{fmtDate(l.created_at)}</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="empty">No leads yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if totalLeads > leads.length}
		<p class="note">Showing top {leads.length} of {totalLeads} by score.</p>
	{/if}
</section>

<style>
	.outreach {
		width: 100%;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.25rem;
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

	.run {
		color: #555;
		font-size: 0.9rem;
		margin: 0.25rem 0 1rem;
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
		white-space: nowrap;
	}

	td:nth-child(3) {
		white-space: normal;
		min-width: 220px;
	}

	thead th {
		position: sticky;
		top: 0;
		background: #f8fafc;
		color: #334155;
		font-weight: 700;
		border-bottom: 1px solid #e5e7eb;
	}

	tbody tr:hover {
		background: #fcfcfd;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
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
	}

	.status-new {
		background: #ecfdf5;
		color: #065f46;
	}

	.status-contacted {
		background: #eff6ff;
		color: #1e40af;
	}

	.status-qualified {
		background: #fff7ed;
		color: #92400e;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		padding: 1.5rem;
	}

	.note {
		color: #9ca3af;
		font-size: 0.8rem;
		margin-top: 0.6rem;
	}
</style>
