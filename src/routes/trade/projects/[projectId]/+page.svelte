<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { decodeHtmlEntities } from '$lib/html';

	type ZProject = any;
	type ZTask = any;
	type ZActivity = any;

	const CACHE_PREFIX = 'cpr:trade:projects:detail:';

	let project = $state<ZProject | null>(null);
	let tasks = $state<ZTask[]>([]);
	let activities = $state<ZActivity[]>([]);
	let loading = $state(true);

	let error = $state('');

	const formatDate = (value: any) => {
		if (!value) return '—';
		const raw = String(value).trim();
		const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (dateOnly) {
			const [, y, m, d] = dateOnly;
			return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
		}
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? raw : parsed.toLocaleDateString();
	};

	const formatDateTime = (value: any) => {
		if (!value) return '—';
		const parsed = new Date(String(value).trim());
		return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString();
	};

	const asText = (value: any, fallback = 'Unknown') => {
		if (typeof value === 'string') return value.trim() || fallback;
		if (value && typeof value === 'object') {
			const c = value?.name ?? value?.display_value ?? value?.value ?? null;
			if (typeof c === 'string' && c.trim()) return c.trim();
		}
		return fallback;
	};

	const getProjectName = (p: any) => p?.name ?? p?.project_name ?? p?.Project_Name ?? 'Project';
	const getProjectStatus = (p: any) => asText(p?.status ?? p?.project_status ?? p?.Status ?? null);
	const getProjectStart = (p: any) => p?.start_date ?? p?.start_date_string ?? null;
	const getProjectEnd = (p: any) => p?.end_date ?? p?.end_date_string ?? null;
	const getProjectPercent = (p: any) =>
		p?.percent_complete ?? p?.percent_completed ?? p?.completed_percent ?? null;
	const getProgressPhotosHref = (p: any) => {
		const dealId = String(p?.deal_id || '').trim();
		if (dealId) return `/api/trade/deals/${encodeURIComponent(dealId)}/progress-photos`;
		return '/trade/photos';
	};

	const taskGroups = $derived.by(() => {
		const groups = new Map<string, ZTask[]>();
		for (const task of tasks) {
			const name =
				task?.tasklist?.name ??
				task?.tasklist_name ??
				task?.tasklist?.tasklist_name ??
				task?.tasklist?.task_list_name ??
				'Tasks';
			const key = String(name || 'Tasks');
			const list = groups.get(key) || [];
			list.push(task);
			groups.set(key, list);
		}
		return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
	});

	const getTaskName = (task: any) => task?.name ?? task?.task_name ?? 'Untitled task';
	const getTaskStatus = (task: any) => asText(task?.status ?? task?.task_status ?? null);
	const getTaskAssignee = (task: any) =>
		task?.owner?.name ?? task?.assignee?.name ?? task?.person_responsible ?? task?.user_name ?? '—';
	const getTaskPriority = (task: any) => task?.priority ?? task?.task_priority ?? '—';
	const getTaskPercent = (task: any) =>
		task?.percent_complete ?? task?.percent_completed ?? task?.completed_percent ?? null;

	const TASK_STATUSES = [
		{ value: 'not_started', label: 'Not Started (0%)' },
		{ value: 'in_progress', label: 'In Progress (50%)' },
		{ value: 'completed', label: 'Completed (100%)' }
	];

	let tasksOpen = $state(false);
	let activityOpen = $state(false);

	// Batch status tracking with 5-second auto-submit
	let pendingChanges = $state(new Map<string, string>());
	let submitting = $state(false);
	let submitResults = $state<{ taskId: string; taskName: string; ok: boolean; error?: string }[]>([]);
	let showResults = $state(false);
	let countdownSeconds = $state(0);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	const pendingCount = $derived(pendingChanges.size);

	const normalizeStatus = (raw: string): string => {
		const lower = raw.toLowerCase().replace(/\s+/g, '_');
		if (lower === 'open' || lower === 'not_started') return 'not_started';
		if (
			lower === 'in_progress' ||
			lower === '25%' ||
			lower === '50%' ||
			lower === '75%' ||
			lower === 'in_review' ||
			lower === 'approval_needed'
		) return 'in_progress';
		if (lower === 'completed' || lower === 'closed' || lower === 'done' || lower === 'complete') return 'completed';
		return 'not_started';
	};

	const getTaskStatusValue = (task: any): string => {
		const raw = getTaskStatus(task);
		return normalizeStatus(raw);
	};

	/** Get the displayed status for a task — pending change overrides the server value */
	const getDisplayStatus = (task: any): string => {
		const tid = String(task?.id || task?.id_string || '');
		if (pendingChanges.has(tid)) return pendingChanges.get(tid)!;
		return getTaskStatusValue(task);
	};

	function clearTimers() {
		if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
		if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
		countdownSeconds = 0;
	}

	function startAutoSubmitTimer() {
		clearTimers();
		countdownSeconds = 5;
		countdownInterval = setInterval(() => {
			countdownSeconds = Math.max(0, countdownSeconds - 1);
		}, 1000);
		debounceTimer = setTimeout(() => {
			clearTimers();
			submitChanges();
		}, 5000);
	}

	/** When a select changes, track it as a pending change (or remove if reverted to original) */
	function onStatusChange(task: any, newStatus: string) {
		const tid = String(task?.id || task?.id_string || '');
		if (!tid) return;
		const originalStatus = getTaskStatusValue(task);

		const next = new Map(pendingChanges);
		if (newStatus === originalStatus) {
			next.delete(tid);
		} else {
			next.set(tid, newStatus);
		}
		pendingChanges = next;
		showResults = false;

		// If there are pending changes, (re)start the 5s auto-submit countdown
		if (pendingChanges.size > 0 && !submitting) {
			startAutoSubmitTimer();
		} else if (pendingChanges.size === 0) {
			clearTimers();
		}
	}

	/** Submit all pending changes to Zoho */
	async function submitChanges() {
		if (pendingChanges.size === 0 || submitting) return;
		submitting = true;
		showResults = false;
		submitResults = [];

		const projectId = $page.params.projectId;
		const entries = Array.from(pendingChanges.entries());

		// Build a lookup for task names
		const taskMap = new Map<string, any>();
		for (const task of tasks) {
			const tid = String(task?.id || task?.id_string || '');
			if (tid) taskMap.set(tid, task);
		}

		// Fire all updates in parallel
		const results = await Promise.allSettled(
			entries.map(async ([taskId, status]) => {
				const res = await fetch(
					`/api/trade/projects/${projectId}/tasks/${taskId}/status`,
					{
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ status })
					}
				);

				if (res.status === 401) {
					window.location.href = '/auth/trade';
					throw new Error('Session expired');
				}

				const payload = await res.json().catch(() => ({}));
				if (!res.ok) {
					throw new Error(payload?.error || `Failed (${res.status})`);
				}
				return { taskId, status };
			})
		);

		const succeeded: string[] = [];
		const newResults: typeof submitResults = [];

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			const [taskId] = entries[i];
			const task = taskMap.get(taskId);
			const taskName = task ? decodeHtmlEntities(getTaskName(task)) : taskId;

			if (result.status === 'fulfilled') {
				succeeded.push(taskId);
				newResults.push({ taskId, taskName, ok: true });

				// Update the task object in-place so the UI reflects the new status
				if (task) {
					const label = TASK_STATUSES.find((s) => s.value === entries[i][1])?.label || entries[i][1];
					if (task.status && typeof task.status === 'object') {
						task.status = { ...task.status, name: label };
					} else {
						task.status = label;
					}
					task.task_status = label;
				}
			} else {
				const errMsg = result.reason instanceof Error ? result.reason.message : 'Update failed';
				newResults.push({ taskId, taskName, ok: false, error: errMsg });
			}
		}

		// Remove succeeded from pending
		const next = new Map(pendingChanges);
		for (const id of succeeded) next.delete(id);
		pendingChanges = next;

		submitResults = newResults;
		showResults = true;
		submitting = false;

		// Clear cache so next visit gets fresh data
		try { sessionStorage.removeItem(getCacheKey()); } catch { /* ignore */ }
	}

	function clearPending() {
		clearTimers();
		pendingChanges = new Map();
		showResults = false;
		submitResults = [];
	}

	const getActivityText = (a: any) =>
		a?.description ?? a?.activity ?? a?.activity_name ?? a?.title ?? a?.content ?? 'Activity';
	const getActivityWhen = (a: any) =>
		a?.time ?? a?.created_time ?? a?.created_time_string ?? a?.date ?? null;

	function getCacheKey() {
		return `${CACHE_PREFIX}${$page.params.projectId}`;
	}

	function loadFromCache(): boolean {
		try {
			const raw = sessionStorage.getItem(getCacheKey());
			if (!raw) return false;
			const cached = JSON.parse(raw);
			if (cached?.project) {
				project = cached.project;
				tasks = cached.tasks || [];
				activities = cached.activities || [];
				return true;
			}
		} catch {
			/* ignore */
		}
		return false;
	}

	function saveToCache(data: { project: any; tasks: any[]; activities: any[] }) {
		try {
			sessionStorage.setItem(getCacheKey(), JSON.stringify({ ...data, ts: Date.now() }));
		} catch {
			/* storage full */
		}
	}

	async function fetchDetail(isRefresh: boolean, bustCache = false) {
		try {
			const projectId = $page.params.projectId;
			const qs = bustCache ? '?fresh' : '';
			const res = await fetch(`/api/trade/projects/${projectId}${qs}`);
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = '/auth/trade';
					return;
				}
				if (res.status === 403) {
					try { sessionStorage.removeItem('cpr:trade:projects:list'); } catch { /* ignore */ }
					try { sessionStorage.removeItem(getCacheKey()); } catch { /* ignore */ }
					window.location.href = '/trade/projects';
					return;
				}
				const detail = await res.text().catch(() => '');
				throw new Error(detail || 'Failed to load project');
			}
			const data = await res.json().catch(() => ({}));
			project = data.project ?? null;
			tasks = data.tasks || [];
			activities = data.activities || [];
			saveToCache({ project, tasks, activities });
			error = '';
		} catch (err) {
			if (!isRefresh) {
				error = err instanceof Error ? err.message : 'Unknown error';
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const hadCache = loadFromCache();
		if (hadCache) {
			loading = false;
			fetchDetail(true);
		} else {
			fetchDetail(false);
		}
	});

	onDestroy(() => {
		clearTimers();
	});
</script>

<div class="project-detail">
	{#if loading}
		<div class="loading">Loading project...</div>
	{:else if error}
		<div class="error">
			<p>{error}</p>
			<a href="/trade/projects">Back to Projects</a>
		</div>
	{:else if project}
		<header class="header">
			<a class="back" href="/trade/projects">← Projects</a>
			<div class="title-row">
				<h1>{getProjectName(project)}</h1>
				<span class="badge">{getProjectStatus(project)}</span>
			</div>
			<p class="sub">
				Dates: {formatDate(getProjectStart(project))} to {formatDate(getProjectEnd(project))}
			</p>
			{#if getProjectPercent(project) !== null && getProjectPercent(project) !== undefined}
				<p class="sub">Complete: {Number(getProjectPercent(project)).toFixed(0)}%</p>
			{/if}
			<div class="header-actions">
				<a class="btn-secondary" href={getProgressPhotosHref(project)}>Progress Photos</a>
			</div>
		</header>

		<section class="section">
			<button class="section-toggle" onclick={() => (tasksOpen = !tasksOpen)}>
				<span>Tasks</span>
				<span class="chevron" class:open={tasksOpen}>▾</span>
			</button>
			{#if tasksOpen}
				{#if tasks.length === 0}
					<p class="section-empty">{project?.source === 'crm_deal' ? 'No Zoho project linked to this deal yet.' : 'No tasks found.'}</p>
				{:else}
					{#each taskGroups as group (group.name)}
						<h3 class="group-title">{group.name}</h3>
						<div class="card-list">
							{#each group.items as task (task?.id || task?.id_string)}
								{@const tid = String(task?.id || task?.id_string || '')}
								{@const displayStatus = getDisplayStatus(task)}
								{@const isPending = pendingChanges.has(tid)}
								<div class="card-row" class:card-pending={isPending}>
									<div class="card-info">
										<p class="card-title">{decodeHtmlEntities(getTaskName(task))}</p>
										<p class="card-assignee">{getTaskAssignee(task)}</p>
									</div>
									{#if project?.source === 'crm_deal'}
										<span class="badge">{getTaskStatus(task)}</span>
									{:else}
										<select
											class="status-select status-{displayStatus}"
											value={displayStatus}
											disabled={submitting}
											onchange={(e) => onStatusChange(task, e.currentTarget.value)}
										>
											{#each TASK_STATUSES as opt}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
									{/if}
								</div>
							{/each}
						</div>
					{/each}

					<!-- Submit results -->
					{#if showResults && submitResults.length > 0}
						<div class="submit-results">
							{#each submitResults as r (r.taskId)}
								<p class="result-item" class:result-ok={r.ok} class:result-fail={!r.ok}>
									{#if r.ok}
										<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10l3 3 7-7"/></svg>
									{:else}
										<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l8 8M14 6l-8 8"/></svg>
									{/if}
									<span class="result-name">{r.taskName}</span>
									{#if !r.ok}<span class="result-error">{r.error}</span>{/if}
								</p>
							{/each}
						</div>
					{/if}
				{/if}
			{/if}
		</section>

		<section class="section">
			<button class="section-toggle" onclick={() => (activityOpen = !activityOpen)}>
				<span>Recent Activity</span>
				<span class="chevron" class:open={activityOpen}>▾</span>
			</button>
			{#if activityOpen}
				{#if activities.length === 0}
					<p class="section-empty">No activity found.</p>
				{:else}
					<div class="activity">
						{#each activities as activity}
							<div class="activity-item">
								<p class="activity-text">{decodeHtmlEntities(getActivityText(activity))}</p>
								<p class="activity-when">{formatDateTime(getActivityWhen(activity))}</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	{/if}
</div>

<!-- Sticky bottom bar for pending changes -->
{#if pendingCount > 0 || submitting}
	<div class="submit-bar">
		<div class="submit-bar-inner">
			<span class="submit-count">{pendingCount} task{pendingCount === 1 ? '' : 's'} changed</span>
			<div class="submit-actions">
				{#if submitting}
					<span class="submit-status">Saving...</span>
				{:else if countdownSeconds > 0}
					<span class="submit-status">Saving in {countdownSeconds}s</span>
					<button class="btn-cancel" type="button" onclick={clearPending}>Cancel</button>
				{:else}
					<button class="btn-cancel" type="button" onclick={clearPending}>Cancel</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Mobile-first base */
	.project-detail {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.25rem;
		padding-bottom: 6rem;
	}

	.loading {
		padding: 2rem;
		text-align: center;
		color: #6b7280;
	}

	.error {
		padding: 1.25rem;
		border: 1px solid #fecaca;
		background: #fff5f5;
		border-radius: 12px;
	}

	.error a {
		display: inline-flex;
		align-items: center;
		margin-top: 0.75rem;
		color: #0066cc;
		text-decoration: none;
		min-height: 44px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		margin-bottom: 0.75rem;
		color: #6b7280;
		text-decoration: none;
		font-size: 0.9rem;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
	}

	.back:hover {
		color: #111827;
	}

	.header {
		margin-bottom: 1.5rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
	}

	.sub {
		margin: 0.2rem 0 0;
		color: #6b7280;
		font-size: 0.88rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.65rem;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		background: #fff;
		color: #111827;
		font-weight: 600;
		font-size: 0.8rem;
	}

	.header-actions {
		margin-top: 0.75rem;
		display: flex;
		gap: 0.5rem;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.6rem 1rem;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.88rem;
		text-decoration: none;
		background: #f9fafb;
		color: #374151;
		border: 1px solid #e5e7eb;
		-webkit-tap-highlight-color: transparent;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.section {
		margin-bottom: 2rem;
	}

	.section-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		border-bottom: 1px solid #e5e7eb;
		padding: 0.6rem 0;
		margin-bottom: 0.75rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: #111827;
		cursor: pointer;
		text-align: left;
	}

	.chevron {
		font-size: 1rem;
		transition: transform 0.2s;
		display: inline-block;
		transform: rotate(-90deg);
	}

	.chevron.open {
		transform: rotate(0deg);
	}

	.section-empty {
		color: #6b7280;
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
	}

	.group-title {
		margin: 1rem 0 0.6rem;
		color: #374151;
		font-size: 0.95rem;
	}

	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	/* Mobile: task cards stack vertically with status below */
	.card-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.card-pending {
		border-color: #f59e0b;
		box-shadow: inset 3px 0 0 #f59e0b;
	}

	.card-info {
		min-width: 0;
	}

	.card-title {
		margin: 0;
		font-weight: 600;
		font-size: 0.92rem;
		line-height: 1.3;
	}

	.card-assignee {
		margin: 0.15rem 0 0;
		font-size: 0.82rem;
		color: #6b7280;
	}

	.status-select {
		appearance: auto;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.88rem;
		min-height: 44px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
		cursor: pointer;
		width: 100%;
		-webkit-tap-highlight-color: transparent;
	}

	.status-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.status-not_started {
		border-color: #d1d5db;
		background: #f9fafb;
	}

	.status-in_progress {
		border-color: #93c5fd;
		background: #eff6ff;
		color: #1d4ed8;
	}

	.status-completed {
		border-color: #86efac;
		background: #f0fdf4;
		color: #15803d;
	}

	/* ── Submit results ─────────────────────────────────── */
	.submit-results {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.result-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.3;
	}

	.result-item svg {
		flex-shrink: 0;
	}

	.result-ok svg {
		color: #16a34a;
	}

	.result-fail svg {
		color: #dc2626;
	}

	.result-name {
		font-weight: 600;
		color: #111827;
	}

	.result-error {
		color: #dc2626;
		font-size: 0.8rem;
	}

	/* ── Sticky submit bar ──────────────────────────────── */
	.submit-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 50;
		background: rgba(255, 255, 255, 0.97);
		border-top: 1px solid #e5e7eb;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
		padding: 0.75rem 1rem;
		animation: slideUp 0.2s ease;
	}

	@keyframes slideUp {
		from { transform: translateY(100%); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	.submit-bar-inner {
		max-width: 1000px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.submit-count {
		font-size: 0.88rem;
		font-weight: 600;
		color: #92400e;
		background: #fef3c7;
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
	}

	.submit-status {
		font-size: 0.85rem;
		font-weight: 600;
		color: #6b7280;
	}

	.submit-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-cancel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.5rem 1rem;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		background: #fff;
		color: #6b7280;
		border: 1px solid #d1d5db;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.btn-cancel:hover {
		background: #f9fafb;
	}

	.btn-cancel:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}



	/* ── Activity ─────────────────────────────────────── */
	.activity {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.activity-item {
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
	}

	.activity-text {
		margin: 0 0 0.2rem;
		font-size: 0.9rem;
		line-height: 1.4;
	}

	.activity-when {
		margin: 0;
		color: #9ca3af;
		font-size: 0.8rem;
	}

	/* Desktop */
	@media (min-width: 640px) {
		.project-detail {
			padding: 2rem;
			padding-bottom: 6rem;
		}

		h1 {
			font-size: 1.6rem;
		}

		.card-row {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
			padding: 1rem;
		}

		.card-info {
			flex: 1;
		}

		.status-select {
			width: 180px;
			flex-shrink: 0;
			border-radius: 999px;
			min-height: 36px;
			padding: 0.35rem 0.5rem;
		}

		.submit-bar {
			padding: 0.75rem 2rem;
		}
	}
</style>
