<script lang="ts">
	import { onMount } from 'svelte';
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

	const TASK_STATUSES = [
		{ value: 'not_started', label: 'Not Started (0%)' },
		{ value: 'in_progress', label: 'In Progress (50%)' },
		{ value: 'completed', label: 'Completed (100%)' }
	];

	let tasksOpen = $state(true);
	let activityOpen = $state(false);

	/*
	 * Form approach: the browser owns select values. We never touch them after
	 * initial render. On submit we read the DOM. This prevents any re-render
	 * from resetting what the user has selected.
	 */

	// originalStatuses is plain JS — NOT $state — so Svelte never re-renders when it changes
	const originalStatuses: Record<string, string> = {};

	// Only these three values are reactive — they only affect the header button, not the task list
	let pendingCount = $state(0);
	let submitting = $state(false);
	let submitResult = $state<{ ok: number; fail: number } | null>(null);

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

	const getTaskStatusValue = (task: any): string => normalizeStatus(getTaskStatus(task));

	// Called once after initial task load — records originals, never called again
	function recordOriginals(taskList: any[]) {
		for (const task of taskList) {
			const tid = String(task?.id || task?.id_string || '');
			if (tid) originalStatuses[tid] = getTaskStatusValue(task);
		}
	}

	// Count how many selects differ from their original value
	function countPending() {
		let count = 0;
		const selects = document.querySelectorAll<HTMLSelectElement>('select[data-tid]');
		for (const sel of selects) {
			const tid = sel.dataset.tid!;
			if (sel.value !== originalStatuses[tid]) count++;
		}
		pendingCount = count;
	}

	async function submitChanges() {
		if (submitting) return;

		const toSubmit: Array<{ taskId: string; status: string }> = [];
		const selects = document.querySelectorAll<HTMLSelectElement>('select[data-tid]');
		for (const sel of selects) {
			const tid = sel.dataset.tid!;
			const newStatus = sel.value;
			if (newStatus && newStatus !== originalStatuses[tid]) {
				toSubmit.push({ taskId: tid, status: newStatus });
			}
		}
		if (toSubmit.length === 0) return;

		submitting = true;
		submitResult = null;
		const projectId = $page.params.projectId;

		// Single round-trip: batch endpoint handles auth once + parallel Zoho calls server-side
		try {
			const res = await fetch(`/api/trade/projects/${projectId}/tasks/batch-status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ updates: toSubmit })
			});
			if (res.status === 401) { window.location.href = '/auth/trade'; return; }
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || `Failed (${res.status})`);

			const results: Array<{ taskId: string; ok: boolean }> = payload.results ?? [];
			let ok = 0, fail = 0;
			for (const r of results) {
				if (r.ok) { originalStatuses[r.taskId] = toSubmit.find(u => u.taskId === r.taskId)?.status ?? originalStatuses[r.taskId]; ok++; }
				else fail++;
			}
			submitResult = { ok, fail };
			try { sessionStorage.removeItem(getCacheKey()); } catch { /* ignore */ }
			if (fail === 0) setTimeout(() => { submitResult = null; }, 4000);
		} catch {
			submitResult = { ok: 0, fail: toSubmit.length };
		} finally {
			submitting = false;
			pendingCount = 0;
		}
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
		} catch { /* ignore */ }
		return false;
	}

	function saveToCache(data: { project: any; tasks: any[]; activities: any[] }) {
		try {
			sessionStorage.setItem(getCacheKey(), JSON.stringify({ ...data, ts: Date.now() }));
		} catch { /* storage full */ }
	}

	async function fetchDetail(isRefresh: boolean, bustCache = false) {
		try {
			const projectId = $page.params.projectId;
			const qs = bustCache ? '?fresh' : '';
			const res = await fetch(`/api/trade/projects/${projectId}${qs}`);
			if (!res.ok) {
				if (res.status === 401) { window.location.href = '/auth/trade'; return; }
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
			activities = data.activities || [];

			// Only update tasks on first load — background refresh must NOT overwrite
			// the task list because that would re-render the selects and reset user edits
			if (!isRefresh) {
				tasks = data.tasks || [];
				recordOriginals(tasks);
			}

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
			recordOriginals(tasks);
			// No background fetch — Submit Changes busts the cache so next visit loads fresh.
		} else {
			fetchDetail(false);
		}
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
				{#if project?.source !== 'crm_deal'}
					<a class="btn-secondary" href="/trade/field-update{project?.deal_id ? `?deal=${encodeURIComponent(project.deal_id)}` : ''}">Field Update</a>
				{/if}
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
								{@const initVal = getTaskStatusValue(task)}
								<div class="card-row">
									<div class="card-info">
										<p class="card-title">{decodeHtmlEntities(getTaskName(task))}</p>
										<p class="card-assignee">{getTaskAssignee(task)}</p>
									</div>
									{#if project?.source === 'crm_deal'}
										<span class="badge">{getTaskStatus(task)}</span>
									{:else}
										<select
											class="status-select status-{initVal}"
											data-tid={tid}
											disabled={submitting}
											onchange={countPending}
										>
											{#each TASK_STATUSES as opt}
												<option value={opt.value} selected={opt.value === initVal}>{opt.label}</option>
											{/each}
										</select>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				{/if}
			{/if}
			<div class="submit-row">
				<button
					class="btn-submit"
					type="button"
					disabled={submitting}
					onclick={submitChanges}
				>
					{submitting ? 'Saving...' : pendingCount > 0 ? `Submit Changes (${pendingCount})` : 'Submit Changes'}
				</button>
				{#if submitResult}
					{#if submitResult.fail === 0}
						<span class="result-ok">✓ {submitResult.ok} task{submitResult.ok !== 1 ? 's' : ''} updated</span>
					{:else}
						<span class="result-err">✗ {submitResult.fail} failed, {submitResult.ok} updated</span>
					{/if}
				{/if}
			</div>
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

<style>
	/* Mobile-first base */
	.project-detail {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.25rem;
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
		flex-wrap: wrap;
		align-items: center;
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

	/* ── Submit Changes button ── */
	.submit-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	.btn-submit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.6rem 1.25rem;
		border-radius: 10px;
		font-weight: 700;
		font-size: 0.88rem;
		background: #111827;
		color: #fff;
		border: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
	}

	.btn-submit:hover:not(:disabled) {
		background: #1f2937;
	}

	.btn-submit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.submit-result {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
	}

	.result-ok { color: #16a34a; font-weight: 600; }
	.result-err { color: #dc2626; font-weight: 600; }

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

	.card-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
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

	.status-not_started { border-color: #d1d5db; background: #f9fafb; }
	.status-in_progress { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
	.status-completed   { border-color: #86efac; background: #f0fdf4; color: #15803d; }

	/* ── Activity ── */
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
		.project-detail { padding: 2rem; }
		h1 { font-size: 1.6rem; }

		.card-row {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
			padding: 1rem;
		}

		.card-info { flex: 1; }

		.status-select {
			width: 180px;
			border-radius: 999px;
			min-height: 36px;
			padding: 0.35rem 0.5rem;
		}
	}
</style>
