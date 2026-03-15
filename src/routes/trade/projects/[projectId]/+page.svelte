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
	let refreshing = $state(false);
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

	let updatingTaskIds = $state(new Set<string>());
	let taskStatusErrors = $state(new Map<string, string>());

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

	async function updateTaskStatus(task: any, newStatus: string) {
		const taskId = String(task?.id || task?.id_string || '');
		if (!taskId || !project) return;

		const prevStatus = task?.status;
		const prevTaskStatus = task?.task_status;

		updatingTaskIds = new Set([...updatingTaskIds, taskId]);
		taskStatusErrors = new Map([...taskStatusErrors]);
		taskStatusErrors.delete(taskId);

		// Optimistic update
		const label = TASK_STATUSES.find((s) => s.value === newStatus)?.label || newStatus;
		if (task.status && typeof task.status === 'object') {
			task.status = { ...task.status, name: label };
		} else {
			task.status = label;
		}
		tasks = [...tasks];

		try {
			const projectId = $page.params.projectId;
			const res = await fetch(
				`/api/trade/projects/${projectId}/tasks/${taskId}/status`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: newStatus })
				}
			);

			if (res.status === 401) {
				window.location.href = '/auth/trade';
				return;
			}

			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(payload?.error || `Failed to update (${res.status})`);
			}
			// Success — invalidate caches and re-fetch from Zoho so UI reflects real state
			try { sessionStorage.removeItem(getCacheKey()); } catch { /* ignore */ }
			await fetchDetail(true, true);
		} catch (err) {
			// Revert optimistic update
			task.status = prevStatus;
			task.task_status = prevTaskStatus;
			tasks = [...tasks];
			taskStatusErrors = new Map([...taskStatusErrors]);
			taskStatusErrors.set(taskId, err instanceof Error ? err.message : 'Update failed');
		} finally {
			updatingTaskIds = new Set([...updatingTaskIds]);
			updatingTaskIds.delete(taskId);
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
		if (isRefresh) refreshing = true;
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
					error = 'Not authorized';
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
			refreshing = false;
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
		{#if refreshing}
			<div class="refreshing">Updating...</div>
		{/if}
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
			<h2>Tasks</h2>
			{#if tasks.length === 0}
				<p class="section-empty">{project?.source === 'crm_deal' ? 'No Zoho project linked to this deal yet.' : 'No tasks found.'}</p>
			{:else}
				{#each taskGroups as group}
					<h3 class="group-title">{group.name}</h3>
					<div class="card-list">
						{#each group.items as task}
							{@const tid = String(task?.id || task?.id_string || '')}
							<div class="card-row">
								<div class="card-info">
									<p class="card-title">{decodeHtmlEntities(getTaskName(task))}</p>
									<p class="card-assignee">{getTaskAssignee(task)}</p>
									{#if taskStatusErrors.has(tid)}
										<p class="task-error">{taskStatusErrors.get(tid)}</p>
									{/if}
								</div>
								{#if project?.source === 'crm_deal'}
									<span class="badge">{getTaskStatus(task)}</span>
								{:else}
									<select
										class="status-select status-{getTaskStatusValue(task)}"
										value={getTaskStatusValue(task)}
										disabled={updatingTaskIds.has(tid)}
										onchange={(e) => updateTaskStatus(task, e.currentTarget.value)}
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
			{/if}
		</section>

		<section class="section">
			<h2>Recent Activity</h2>
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
		</section>
	{/if}
</div>

<style>
	.project-detail {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem;
	}

	.loading {
		padding: 2rem;
		text-align: center;
		color: #666;
	}

	.refreshing {
		padding: 0.4rem 0.75rem;
		margin-bottom: 0.75rem;
		font-size: 0.88rem;
		color: #6b7280;
		text-align: center;
	}

	.error {
		padding: 2rem;
		border: 1px solid #fecaca;
		background: #fff5f5;
		border-radius: 10px;
	}

	.error a {
		display: inline-block;
		margin-top: 0.75rem;
		color: #0066cc;
		text-decoration: none;
	}

	.back {
		display: inline-block;
		margin-bottom: 1rem;
		color: #6b7280;
		text-decoration: none;
		font-size: 0.95rem;
	}

	.back:hover {
		color: #111827;
	}

	.header {
		margin-bottom: 2rem;
	}

	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0 0 0.25rem;
	}

	.sub {
		margin: 0.25rem 0 0;
		color: #4b5563;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		background: #fff;
		color: #111827;
		font-weight: 600;
		min-height: 36px;
	}

	.header-actions {
		margin-top: 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 42px;
		padding: 0.7rem 1rem;
		border-radius: 10px;
		font-weight: 700;
		text-decoration: none;
		background: #f9fafb;
		color: #111827;
		border: 1px solid #d1d5db;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
		border-color: #cbd5e1;
	}

	.section {
		margin-bottom: 2.5rem;
	}

	.section-empty {
		color: #6b7280;
		margin: 0.5rem 0 0;
	}

	.group-title {
		margin: 1rem 0 0.75rem;
		color: #374151;
		font-size: 1.05rem;
	}

	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
	}

	.card-info {
		min-width: 0;
		flex: 1;
	}

	.card-title {
		margin: 0;
		font-weight: 600;
	}

	.card-assignee {
		margin: 0.2rem 0 0;
		font-size: 0.88rem;
		color: #6b7280;
	}

	.task-error {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: #b91c1c;
	}

	.status-select {
		appearance: auto;
		padding: 0.35rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.88rem;
		min-height: 36px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
		cursor: pointer;
		flex-shrink: 0;
		width: 150px;
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

	.activity {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.activity-item {
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
	}

	.activity-text {
		margin: 0 0 0.25rem;
	}

	.activity-when {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
	}

	@media (max-width: 720px) {
		.project-detail {
			padding: 1.5rem 1.25rem;
		}

		.card-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.status-select {
			width: 100%;
			max-width: 180px;
		}
	}
</style>
