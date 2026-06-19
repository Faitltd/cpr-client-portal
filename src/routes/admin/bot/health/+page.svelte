<script lang="ts">
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	let triggering = $state(false);
	let triggerStatus = $state('');

	async function runNow(limit = 25) {
		if (triggering) return;
		triggering = true;
		triggerStatus = 'Running…';
		try {
			// Detached mode: server kicks off the sync and returns immediately.
			// We don't wait for the full run — Render's HTTP layer times out
			// before a 30-deal × all-sources sync finishes (especially when
			// OCR is involved). Refresh the page in a few seconds to see the
			// run start in the activity log.
			const res = await fetch('/api/admin/bot/sync-all?detached=1', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit, detached: true })
			});
			const json = await res.json();
			if (!res.ok || !json.ok) throw new Error(json.message || `HTTP ${res.status}`);
			triggerStatus = `Sync started in background — check activity log for progress.`;
			setTimeout(() => location.reload(), 3000);
		} catch (err) {
			triggerStatus = `Failed: ${err instanceof Error ? err.message : 'unknown'}`;
		} finally {
			triggering = false;
		}
	}

	function fmtDate(s: string | null): string {
		if (!s) return '—';
		try {
			return new Date(s).toLocaleString();
		} catch {
			return s;
		}
	}

	function fmtDuration(ms: number | null | undefined): string {
		if (!ms) return '—';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<svelte:head>
	<title>CPR Assistant Health — CPR Admin</title>
</svelte:head>

<section class="page">
	<header class="head">
		<div>
			<h1>CPR Assistant Sync Health</h1>
			<p class="sub">Last 25 sync runs across Cliq, Mail, and Books.</p>
		</div>
		<div class="actions">
			<a class="link" href="/admin/bot">← Back to chat</a>
			<button class="btn-primary" type="button" onclick={() => runNow(25)} disabled={triggering}>
				{triggering ? 'Running…' : 'Run sync now (25 Deals)'}
			</button>
		</div>
	</header>

	{#if triggerStatus}
		<div class="trigger-status">{triggerStatus}</div>
	{/if}

	{#if data.loadError}
		<div class="error">Failed to load runs: {data.loadError}</div>
	{/if}

	{#if data.runs.length === 0}
		<div class="empty">No sync runs yet. Click "Run sync now" to populate.</div>
	{:else}
		<table class="runs-table">
			<thead>
				<tr>
					<th>Started</th>
					<th>Trigger</th>
					<th>Sources</th>
					<th>Deals</th>
					<th>OK / Err</th>
					<th>Duration</th>
					<th>Errors</th>
				</tr>
			</thead>
			<tbody>
				{#each data.runs as run (run.id)}
					{@const errs = (run.deals ?? []).filter((d: any) => d.error || d.cliq?.error || d.books?.error || d.mail?.error)}
					<tr class:has-errors={run.error_count > 0}>
						<td>{fmtDate(run.started_at)}</td>
						<td><span class="pill">{run.trigger}</span></td>
						<td>{(run.sources ?? []).join(', ')}</td>
						<td>{run.deal_count}</td>
						<td>{run.ok_count} / {run.error_count}</td>
						<td>{fmtDuration(run.duration_ms)}</td>
						<td class="err-cell">
							{#if errs.length === 0}
								<span class="ok">—</span>
							{:else}
								<details>
									<summary>{errs.length} Deal{errs.length === 1 ? '' : 's'}</summary>
									<ul>
										{#each errs as d}
											<li>
												<strong>{d.deal_name || d.deal_id}:</strong>
												{[d.error, d.cliq?.error, d.books?.error, d.mail?.error]
													.filter(Boolean)
													.join(' · ')}
											</li>
										{/each}
									</ul>
								</details>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}
	.sub {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
	}
	.actions {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}
	.link {
		color: #2563eb;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.btn-primary {
		padding: 0.55rem 1rem;
		background: #111827;
		color: #ffffff;
		border: none;
		border-radius: 0.5rem;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.trigger-status {
		margin-bottom: 1rem;
		padding: 0.6rem 0.9rem;
		background: #f0f9ff;
		border: 1px solid #bae6fd;
		border-radius: 0.5rem;
		color: #075985;
		font-size: 0.9rem;
	}
	.error {
		padding: 0.6rem 0.9rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		color: #991b1b;
	}
	.empty {
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		background: #f9fafb;
	}
	.runs-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}
	.runs-table th,
	.runs-table td {
		text-align: left;
		padding: 0.55rem 0.7rem;
		border-bottom: 1px solid #e5e7eb;
		vertical-align: top;
	}
	.runs-table th {
		background: #f9fafb;
		font-weight: 600;
		color: #374151;
		font-size: 0.85rem;
	}
	.has-errors td {
		background: #fff7ed;
	}
	.pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		background: #e5e7eb;
		color: #374151;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.err-cell ul {
		margin: 0.3rem 0 0 1rem;
		padding: 0;
		font-size: 0.85rem;
		color: #7c2d12;
	}
	.err-cell summary {
		cursor: pointer;
		color: #c2410c;
	}
	.ok {
		color: #15803d;
	}
</style>
