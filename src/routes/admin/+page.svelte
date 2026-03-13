<script lang="ts">
	import { onMount } from 'svelte';

	interface DashboardData {
		active_projects: number;
		pending_approvals: number;
		open_issues: number;
		recent_logs: Array<{
			id: string;
			deal_id: string;
			trade_partner_id: string | null;
			log_date: string;
			hours_worked: number | null;
			work_completed: string | null;
			created_at: string;
		}>;
		recent_comms: Array<{
			id: string;
			deal_id: string;
			direction: string | null;
			channel: string | null;
			subject: string | null;
			created_at: string;
		}>;
	}

	let data: DashboardData | null = null;
	let loading = true;
	let error = '';

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/dashboard');
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Failed to load');
			data = json.data;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load dashboard';
		} finally {
			loading = false;
		}
	});

	function fmtDate(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}

	function truncate(value: string | null, max = 80) {
		if (!value) return '—';
		return value.length > max ? value.slice(0, max) + '…' : value;
	}
</script>

<div class="container">
	<h1>Dashboard</h1>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if error}
		<p class="error-text">{error}</p>
	{:else if data}
		<div class="metrics-grid">
			<a class="card metric-card" href="/admin/health">
				<span class="metric-value">{data.active_projects}</span>
				<span class="metric-label">Active Projects</span>
			</a>
			<a class="card metric-card metric-warning" href="/admin/approvals">
				<span class="metric-value">{data.pending_approvals}</span>
				<span class="metric-label">Pending Approvals</span>
			</a>
			<a class="card metric-card metric-danger" href="/admin/field-issues">
				<span class="metric-value">{data.open_issues}</span>
				<span class="metric-label">Open Issues</span>
			</a>
		</div>

		<div class="two-col">
			<div class="card section-card">
				<h2>Recent Daily Logs</h2>
				{#if data.recent_logs.length === 0}
					<p class="muted">No recent logs.</p>
				{:else}
					<ul class="activity-list">
						{#each data.recent_logs as log (log.id)}
							<li class="activity-item">
								<div class="activity-top">
									<span class="activity-date">{fmtDate(log.log_date)}</span>
									{#if log.hours_worked !== null}
										<span class="hours-tag">{log.hours_worked} hrs</span>
									{/if}
								</div>
								<span class="activity-detail">{truncate(log.work_completed)}</span>
								<span class="activity-meta muted">Deal: {log.deal_id}</span>
							</li>
						{/each}
					</ul>
					<a class="view-all" href="/admin/daily-logs">View all logs →</a>
				{/if}
			</div>

			<div class="card section-card">
				<h2>Recent Communications</h2>
				{#if data.recent_comms.length === 0}
					<p class="muted">No recent communications.</p>
				{:else}
					<ul class="activity-list">
						{#each data.recent_comms as comm (comm.id)}
							<li class="activity-item">
								<div class="activity-top">
									<span class="activity-date">{fmtDateTime(comm.created_at)}</span>
									{#if comm.direction}
										<span class="badge badge-direction">{comm.direction}</span>
									{/if}
									{#if comm.channel}
										<span class="badge badge-channel">{comm.channel}</span>
									{/if}
								</div>
								<span class="activity-detail">{truncate(comm.subject)}</span>
								<span class="activity-meta muted">Deal: {comm.deal_id}</span>
							</li>
						{/each}
					</ul>
					<a class="view-all" href="/admin/comms">View all comms →</a>
				{/if}
			</div>
		</div>

		<div class="card section-card">
			<h2>Quick Actions</h2>
			<div class="actions-grid">
				<a class="action-btn" href="/admin/health">Project Health</a>
				<a class="action-btn" href="/admin/approvals">Approvals</a>
				<a class="action-btn" href="/admin/field-issues">Field Issues</a>
				<a class="action-btn" href="/admin/daily-logs">Daily Logs</a>
				<a class="action-btn" href="/admin/comms">Communications</a>
				<a class="action-btn" href="/admin/procurement">Procurement</a>
				<a class="action-btn" href="/admin/change-orders">Change Orders</a>
				<a class="action-btn" href="/admin/clients">Clients</a>
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.6rem;
		color: #111827;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
		color: #111827;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.metric-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		text-decoration: none;
		cursor: pointer;
		transition: box-shadow 0.15s, border-color 0.15s;
	}

	.metric-card:hover {
		border-color: #0066cc;
		box-shadow: 0 2px 8px rgba(0, 102, 204, 0.12);
	}

	.metric-warning .metric-value {
		color: #b45309;
	}

	.metric-danger .metric-value {
		color: #b91c1c;
	}

	.metric-value {
		font-size: 2rem;
		font-weight: 700;
		color: #111827;
		line-height: 1;
	}

	.metric-label {
		font-size: 0.82rem;
		color: #6b7280;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.section-card {
		margin-bottom: 2rem;
	}

	.two-col .section-card {
		margin-bottom: 0;
	}

	.activity-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.activity-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-bottom: 0.85rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.activity-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.activity-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.activity-date {
		font-size: 0.85rem;
		font-weight: 600;
		color: #374151;
	}

	.activity-detail {
		font-size: 0.9rem;
		color: #111827;
	}

	.activity-meta {
		font-size: 0.8rem;
	}

	.hours-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: #f3f4f6;
		color: #374151;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge-direction {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.badge-channel {
		background: #f3f4f6;
		color: #374151;
	}

	.view-all {
		display: inline-block;
		margin-top: 0.75rem;
		font-size: 0.88rem;
		color: #0066cc;
		text-decoration: none;
		font-weight: 500;
	}

	.view-all:hover {
		text-decoration: underline;
	}

	.actions-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.65rem 1rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		color: #1a1a1a;
		min-height: 44px;
		font-size: 0.88rem;
		text-decoration: none;
		text-align: center;
		white-space: nowrap;
		transition: background 0.1s;
	}

	.action-btn:hover {
		background: #f3f4f6;
		border-color: #0066cc;
		color: #0066cc;
	}

	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.metrics-grid {
			grid-template-columns: 1fr;
		}

		.two-col {
			grid-template-columns: 1fr;
		}

		.actions-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
