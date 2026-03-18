<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';

	interface DailyLog {
		id: string;
		deal_id: string;
		trade_partner_id: string | null;
		log_date: string;
		hours_worked: number | null;
		work_completed: string | null;
		work_planned: string | null;
		issues_encountered: string | null;
		photo_ids: string[] | null;
		weather_delay: boolean;
		created_at: string;
		updated_at: string;
	}

	interface DateGroup {
		date: string;
		label: string;
		logs: DailyLog[];
	}

	let loadedDealId = '';

	// Data
	let logs: DailyLog[] = [];
	let loading = false;
	let loadError = '';

	// Derived
	$: dateGroups = groupByDate(logs);
	$: totalHours = logs.reduce((sum, l) => sum + (l.hours_worked ?? 0), 0);
	$: weatherDelays = logs.filter((l) => l.weather_delay).length;
	$: logsWithIssues = logs.filter((l) => l.issues_encountered?.trim()).length;

	async function loadDeal(id: string) {
		if (!id) return;
		loadedDealId = id;
		await fetchLogs();
	}

	async function fetchLogs() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/daily-logs?dealId=${encodeURIComponent(loadedDealId)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load');
			logs = json.data ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load daily logs';
		} finally {
			loading = false;
		}
	}

	function groupByDate(allLogs: DailyLog[]): DateGroup[] {
		const map = new Map<string, DailyLog[]>();
		for (const log of allLogs) {
			const date = log.log_date;
			if (!map.has(date)) map.set(date, []);
			map.get(date)!.push(log);
		}
		// Sort dates newest first
		const sorted = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
		return sorted.map(([date, entries]) => ({
			date,
			label: fmtGroupDate(date),
			logs: entries
		}));
	}

	function fmtGroupDate(dateStr: string): string {
		// dateStr is YYYY-MM-DD from Postgres DATE column
		// Parse as local date to avoid UTC offset shifting the day
		const [year, month, day] = dateStr.split('-').map(Number);
		const d = new Date(year, month - 1, day);
		return d.toLocaleDateString(undefined, {
			weekday: 'long',
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}

	function fmtHours(hours: number | null): string {
		if (hours === null || hours === undefined) return '—';
		return hours === 1 ? '1 hr' : `${hours} hrs`;
	}
</script>

<div class="container">
	<h1>Daily Logs</h1>

	<DealSelector on:select={(e) => loadDeal(e.detail.id)} />

	{#if loadedDealId}
		{#if loading}
			<p class="muted">Loading…</p>
		{:else if loadError}
			<p class="error-text">{loadError}</p>
		{:else if logs.length === 0}
			<div class="empty">No daily logs found for this deal.</div>
		{:else}
			<!-- Summary stats -->
			<div class="stats-row">
				<div class="stat-card">
					<span class="stat-value">{logs.length}</span>
					<span class="stat-label">Total Logs</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}</span>
					<span class="stat-label">Total Hours</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">{weatherDelays}</span>
					<span class="stat-label">Weather Delays</span>
				</div>
				<div class="stat-card" class:stat-card-warn={logsWithIssues > 0}>
					<span class="stat-value">{logsWithIssues}</span>
					<span class="stat-label">Logs w/ Issues</span>
				</div>
			</div>

			<!-- Date groups -->
			{#each dateGroups as group (group.date)}
				<div class="date-group">
					<h2 class="date-heading">{group.label}</h2>

					<div class="log-list">
						{#each group.logs as log (log.id)}
							<div class="card log-card">
								<!-- Card header -->
								<div class="log-header">
									<div class="log-header-left">
										<span class="partner-id muted">
											Partner: <strong>{log.trade_partner_id ?? '—'}</strong>
										</span>
										{#if log.hours_worked !== null}
											<span class="hours-tag">⏱ {fmtHours(log.hours_worked)}</span>
										{/if}
										{#if log.weather_delay}
											<span class="badge badge-weather">🌧 Weather Delay</span>
										{/if}
										{#if log.photo_ids && log.photo_ids.length > 0}
											<span class="photos-tag muted">📷 {log.photo_ids.length} photo{log.photo_ids.length === 1 ? '' : 's'}</span>
										{/if}
									</div>
									<span class="timestamp muted">Submitted: {fmtDateTime(log.created_at)}</span>
								</div>

								<!-- Work sections -->
								<div class="work-sections">
									{#if log.work_completed}
										<div class="work-block work-completed">
											<span class="work-label">✅ Work Completed</span>
											<p class="work-text">{log.work_completed}</p>
										</div>
									{/if}

									{#if log.work_planned}
										<div class="work-block work-planned">
											<span class="work-label">📋 Work Planned</span>
											<p class="work-text">{log.work_planned}</p>
										</div>
									{/if}

									{#if log.issues_encountered}
										<div class="work-block work-issues">
											<span class="work-label">⚠️ Issues Encountered</span>
											<p class="work-text">{log.issues_encountered}</p>
										</div>
									{/if}

									{#if !log.work_completed && !log.work_planned && !log.issues_encountered}
										<p class="muted" style="margin: 0;">No notes submitted.</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
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

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	/* Stats */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1rem;
		background: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		text-align: center;
	}

	.stat-card-warn {
		border-color: #fde68a;
		background: #fffbeb;
	}

	.stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: #111827;
		line-height: 1;
	}

	.stat-label {
		font-size: 0.78rem;
		color: #6b7280;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Date groups */
	.date-group {
		margin-bottom: 2rem;
	}

	.date-heading {
		font-weight: 700;
		color: #111827;
		font-size: 1rem;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 0.5rem;
		margin: 1.5rem 0 1rem;
	}

	.log-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Log card */
	.log-card {
		padding: 1.25rem;
	}

	.log-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.log-header-left {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.partner-id {
		font-size: 0.88rem;
	}

	.hours-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: #f3f4f6;
		color: #374151;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.photos-tag {
		font-size: 0.82rem;
	}

	.timestamp {
		font-size: 0.82rem;
		white-space: nowrap;
	}

	/* Badges */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.badge-weather {
		background: #fef3c7;
		color: #92400e;
	}

	/* Work sections */
	.work-sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.work-block {
		border-left: 3px solid;
		border-radius: 0 6px 6px 0;
		padding: 0.65rem 0.9rem;
	}

	.work-completed {
		border-color: #22c55e;
		background: #f0fdf4;
	}

	.work-planned {
		border-color: #3b82f6;
		background: #eff6ff;
	}

	.work-issues {
		border-color: #f59e0b;
		background: #fffbeb;
	}

	.work-label {
		display: block;
		font-size: 0.8rem;
		font-weight: 700;
		color: #374151;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.35rem;
	}

	.work-text {
		margin: 0;
		font-size: 0.92rem;
		color: #1f2937;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	/* Utilities */
	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0 0 1rem;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.stats-row {
			grid-template-columns: repeat(2, 1fr);
		}

		.log-header {
			flex-direction: column;
		}

		.timestamp {
			white-space: normal;
		}
	}
</style>
