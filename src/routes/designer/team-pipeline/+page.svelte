<script lang="ts">
	import type { PageData } from './$types';
	import DealDetail from '$lib/components/pipeline/DealDetail.svelte';
	import type { DesignerDealSummary } from '$lib/types/designer';

	export let data: PageData;

	const STALE_DAYS = 14;

	// Canonical CRM pipeline stage order (from the Deals "Standard" pipeline).
	// Used to sort the list and order the stage chips the way the pipeline flows.
	const STAGE_ORDER = [
		'Ballpark Needed',
		'Ballpark Revision',
		'Ballpark Review Needed',
		'Ballpark Review Booked',
		'PDA Needed',
		'PDA Sent',
		'Selections',
		'Design Needed',
		'Redesign Needed',
		'Estimate Needed',
		'Estimate Review Needed',
		'Estimate Review Booked',
		'Estimate Revision Needed',
		'Quoted',
		'Contract Needed',
		'Contract Sent',
		'On Hold'
	];
	const stageRank = (stage: string | null) => {
		const i = stage ? STAGE_ORDER.indexOf(stage) : -1;
		return i === -1 ? 999 : i;
	};
	// Stages hidden by default (still available via the chips).
	const DEFAULT_HIDDEN_STAGES = new Set(['On Hold']);

	// Full deal records keyed by id, so a row can expand into the same detail
	// card the CRM tab uses (contact, address, fields, notes, editing) — no need
	// to leave the portal, which matters for mobile staff without Zoho accounts.
	$: summaryById = new Map<string, DesignerDealSummary>((data.deals ?? []).map((d) => [d.id, d]));

	// Which deal row is expanded (inline detail). Only one open at a time.
	let expandedId: string | null = null;
	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	const NONE = '__none__';
	const stageKey = (stage: string | null) => (stage && stage.trim() ? stage : NONE);
	const stageLabel = (key: string) => (key === NONE ? 'No stage' : key);

	$: allRows = data.rows ?? [];

	// KPIs reflect the whole open pipeline (not the current filter), matching the
	// native CRM "Sales Pipeline KPIs" dashboard.
	$: kpiActive = allRows.length;
	$: kpiStale = allRows.filter((r) => r.daysSince !== null && r.daysSince >= STALE_DAYS).length;
	$: kpiOpenTasks = allRows.reduce((sum, r) => sum + r.activeTasks, 0);
	$: kpiOverdue = allRows.reduce((sum, r) => sum + r.overdueTasks, 0);
	$: kpiNoNextStep = allRows.filter((r) => r.activeTasks === 0).length;

	$: allStages = Array.from(new Set(allRows.map((r) => stageKey(r.stage)))).sort((a, b) => {
		if (a === NONE) return 1;
		if (b === NONE) return -1;
		return stageRank(a) - stageRank(b) || a.localeCompare(b);
	});

	// Filters: all stages except the default-hidden ones (On Hold) are selected
	// on load; plus a free-text search and an optional "stale only" toggle.
	let selected: Set<string> = new Set();
	let initialized = false;
	$: if (!initialized && allStages.length > 0) {
		selected = new Set(allStages.filter((key) => !DEFAULT_HIDDEN_STAGES.has(key)));
		initialized = true;
	}

	let query = '';
	let staleOnly = false;
	// Default sort: follow the pipeline stage order.
	let sortMode: 'stage' | 'oldest' | 'recent' = 'stage';

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

	$: needle = query.trim().toLowerCase();
	$: visibleRows = allRows.filter((r) => {
		if (!selected.has(stageKey(r.stage))) return false;
		if (staleOnly && !(r.daysSince !== null && r.daysSince >= STALE_DAYS)) return false;
		if (needle) {
			const hay = `${r.name} ${r.stage ?? ''} ${r.owner ?? ''}`.toLowerCase();
			if (!hay.includes(needle)) return false;
		}
		return true;
	});

	// Compare by last point of contact; nulls (nothing logged) always sink to the
	// bottom since they have no date to order on. Positive => a after b.
	const byContactOldestFirst = (a: { lastContact: string | null }, b: { lastContact: string | null }) => {
		if (a.lastContact === null && b.lastContact === null) return 0;
		if (a.lastContact === null) return 1;
		if (b.lastContact === null) return -1;
		return a.lastContact < b.lastContact ? -1 : a.lastContact > b.lastContact ? 1 : 0;
	};

	$: sortedRows = [...visibleRows].sort((a, b) => {
		if (sortMode === 'stage') {
			const s = stageRank(a.stage) - stageRank(b.stage);
			// Within a stage, show the least-recently-contacted first.
			return s !== 0 ? s : byContactOldestFirst(a, b);
		}
		const cmp = byContactOldestFirst(a, b);
		return sortMode === 'oldest' ? cmp : -cmp;
	});

	const fmtDate = (value: string | null) => {
		if (!value) return null;
		const d = new Date(value + 'T00:00:00');
		return Number.isNaN(d.valueOf())
			? value
			: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	};

	// Age styling for the Last Point of Contact column.
	const ageClass = (days: number | null) => {
		if (days === null) return 'age-none';
		if (days >= STALE_DAYS) return 'age-stale';
		if (days >= 7) return 'age-warn';
		return 'age-fresh';
	};
	const ageLabel = (days: number | null) => {
		if (days === null) return 'No contact logged';
		if (days === 0) return 'today';
		if (days === 1) return '1 day ago';
		return `${days} days ago`;
	};
</script>

<svelte:head>
	<title>Pipeline · Designer · CPR Portal</title>
</svelte:head>

{#if data.warning}<div class="warning">{data.warning}</div>{/if}

<div class="summary">
	<div class="stat">
		<span class="stat-label">Active deals</span>
		<span class="stat-value">{kpiActive}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Stale {STALE_DAYS}+ days</span>
		<span class="stat-value alert">{kpiStale}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Open tasks</span>
		<span class="stat-value">{kpiOpenTasks}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Overdue tasks</span>
		<span class="stat-value alert">{kpiOverdue}</span>
	</div>
	<div class="stat">
		<span class="stat-label">No next step</span>
		<span class="stat-value">{kpiNoNextStep}</span>
	</div>
</div>

<div class="filters">
	<div class="filter-head">
		<input
			class="search"
			type="search"
			placeholder="Search name, stage, owner…"
			bind:value={query}
		/>
		<label class="stale-toggle">
			<input type="checkbox" bind:checked={staleOnly} />
			Stale only ({STALE_DAYS}+ days)
		</label>
		<label class="sort-control">
			Sort
			<select bind:value={sortMode}>
				<option value="stage">Pipeline stage</option>
				<option value="oldest">Least recent contact</option>
				<option value="recent">Most recent contact</option>
			</select>
		</label>
		<div class="filter-actions">
			<button type="button" class="link" on:click={selectAll}>All stages</button>
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

{#if visibleRows.length === 0}
	<div class="empty">No deals match the current filters.</div>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Deal</th>
					<th>Stage</th>
					<th>Owner</th>
					<th>Last point of contact</th>
					<th class="num">Active tasks</th>
				</tr>
			</thead>
			<tbody>
				{#each sortedRows as row (row.id)}
					<tr class="deal-row" class:open={expandedId === row.id}>
						<td class="name">
							<button
								type="button"
								class="name-btn"
								on:click={() => toggleExpand(row.id)}
								aria-expanded={expandedId === row.id}
								title="Show deal details"
							>
								<span class="caret">{expandedId === row.id ? '▾' : '▸'}</span>
								{row.name}
							</button>
						</td>
						<td>{#if row.stage}<span class="badge">{row.stage}</span>{:else}—{/if}</td>
						<td>{row.owner ?? '—'}</td>
						<td>
							<span class={ageClass(row.daysSince)}>{ageLabel(row.daysSince)}</span>
							{#if fmtDate(row.lastContact)}<span class="sub">{fmtDate(row.lastContact)}</span>{/if}
						</td>
						<td class="num">
							<span class="tcount" class:zero={row.activeTasks === 0}>{row.activeTasks}</span>
							{#if row.overdueTasks > 0}<span class="od">{row.overdueTasks} overdue</span>{/if}
						</td>
					</tr>
					{#if expandedId === row.id}
						{@const summary = summaryById.get(row.id)}
						<tr class="detail-row">
							<td colspan="5">
								{#if summary}
									<DealDetail deal={summary} />
								{:else}
									<p class="detail-muted">
										Full details for this deal aren’t loaded yet — reload in a moment.
									</p>
								{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
	<p class="caption">
		Tap a deal name to open its full details, notes, and ball-in-court right here — no Zoho
		login needed. Last point of contact is the most recent note, past meeting, or call on the
		deal. Active deals exclude Lost, Completed, and Project Created. Active tasks are
		deal-linked tasks not marked Completed.
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

	.stat-value.alert {
		color: #b91c1c;
	}

	.filters {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
	}

	.filter-head {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}

	.search {
		flex: 1 1 220px;
		min-width: 180px;
		padding: 0.45rem 0.7rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font: inherit;
		font-size: 0.9rem;
	}

	.stale-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: #374151;
		cursor: pointer;
		white-space: nowrap;
	}

	.filter-actions {
		display: flex;
		gap: 0.75rem;
		margin-left: auto;
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
		vertical-align: top;
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
		white-space: normal;
	}

	.name-btn {
		display: inline-flex;
		align-items: flex-start;
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
		padding-top: 0.15rem;
	}

	.deal-row.open td {
		background: #f8fafc;
	}

	.detail-row td {
		background: #f8fafc;
		padding: 0.5rem 0.75rem 1rem;
	}

	.detail-muted {
		margin: 0;
		color: #6b7280;
		font-size: 0.88rem;
	}

	.sort-control {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: #374151;
		white-space: nowrap;
	}

	.sort-control select {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: #fff;
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

	.sub {
		display: block;
		font-size: 0.78rem;
		color: #9ca3af;
	}

	.age-fresh {
		color: #15803d;
		font-weight: 600;
	}
	.age-warn {
		color: #b45309;
		font-weight: 600;
	}
	.age-stale {
		color: #b91c1c;
		font-weight: 700;
	}
	.age-none {
		color: #9ca3af;
	}

	.tcount {
		font-weight: 600;
	}
	.tcount.zero {
		color: #9ca3af;
		font-weight: 400;
	}

	.od {
		display: block;
		font-size: 0.78rem;
		color: #b91c1c;
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
