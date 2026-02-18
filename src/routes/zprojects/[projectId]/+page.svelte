<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	type ZProject = any;
	type ZTask = any;
	type ZActivity = any;

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
			const local = new Date(Number(y), Number(m) - 1, Number(d));
			return local.toLocaleDateString();
		}
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? raw : parsed.toLocaleDateString();
	};

	const formatDateTime = (value: any) => {
		if (!value) return '—';
		const raw = String(value).trim();
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? raw : parsed.toLocaleString();
	};

	const asText = (value: any, fallback = 'Unknown') => {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			return trimmed || fallback;
		}
		if (value && typeof value === 'object') {
			const candidate = value?.name ?? value?.display_value ?? value?.value ?? null;
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
		return fallback;
	};

	const getProjectName = (p: any) => p?.name ?? p?.project_name ?? p?.Project_Name ?? 'Project';
	const getProjectStatus = (p: any) => asText(p?.status ?? p?.project_status ?? p?.Status ?? null);
	const getProjectStart = (p: any) => p?.start_date ?? p?.start_date_string ?? null;
	const getProjectEnd = (p: any) => p?.end_date ?? p?.end_date_string ?? null;
	const getProjectPercent = (p: any) =>
		p?.percent_complete ??
		p?.percent_completed ??
		p?.completed_percent ??
		p?.completion_percentage ??
		null;

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

	const getActivityText = (a: any) =>
		a?.description ??
		a?.activity ??
		a?.activity_name ??
		a?.title ??
		a?.content ??
		'Activity';
	const getActivityWhen = (a: any) => a?.time ?? a?.created_time ?? a?.created_time_string ?? a?.date ?? null;

	onMount(async () => {
		try {
			const projectId = $page.params.projectId;
			const res = await fetch(`/api/zprojects/${projectId}`);
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = '/auth/portal';
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
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="zproject-detail">
	<nav class="top-nav">
		<a href="/zprojects">← Back to Projects</a>
	</nav>

	{#if loading}
		<div class="loading">Loading project...</div>
	{:else if error}
		<div class="error">
			<p>{error}</p>
			<a href="/zprojects">Return to Projects</a>
		</div>
	{:else if project}
		<header class="header">
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
		</header>

		<section class="section">
			<h2>Tasks</h2>
			{#if tasks.length === 0}
				<p class="section-empty">No tasks found.</p>
			{:else}
				{#each taskGroups as group}
					<h3 class="group-title">{group.name}</h3>
					<div class="card-list">
						{#each group.items as task}
							<div class="card-row">
								<div>
									<p class="card-title">{getTaskName(task)}</p>
									<p class="card-meta">
										Status: {getTaskStatus(task)} • Assignee: {getTaskAssignee(task)} • Priority:
										{getTaskPriority(task)}
									</p>
								</div>
								<div class="percent">
									{#if getTaskPercent(task) !== null && getTaskPercent(task) !== undefined}
										{Number(getTaskPercent(task)).toFixed(0)}%
									{:else}
										—
									{/if}
								</div>
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
							<p class="activity-text">{getActivityText(activity)}</p>
							<p class="activity-when">{formatDateTime(getActivityWhen(activity))}</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.zproject-detail {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem;
	}

	.top-nav {
		margin-bottom: 1.5rem;
	}

	.top-nav a {
		color: #0066cc;
		text-decoration: none;
	}

	.loading {
		padding: 2rem;
		text-align: center;
		color: #666;
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
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
	}

	.card-title {
		margin: 0 0 0.25rem;
		font-weight: 600;
	}

	.card-meta {
		margin: 0;
		color: #4b5563;
	}

	.percent {
		min-width: 4rem;
		text-align: right;
		font-weight: 700;
		color: #111827;
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
		.zproject-detail {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
