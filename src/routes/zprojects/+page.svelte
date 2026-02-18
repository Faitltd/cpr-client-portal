<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	type ZProject = any;

	const CACHE_KEY = 'cpr:zprojects:list';

	let projects = $state<ZProject[]>([]);
	let loading = $state(true);
	let refreshing = $state(false);
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

	const toCount = (value: any): number | null => {
		if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
		if (typeof value === 'string') {
			const parsed = Number(value.trim());
			return Number.isFinite(parsed) ? Math.round(parsed) : null;
		}
		return null;
	};

	const getId = (project: any) =>
		project?.id ?? project?.project_id ?? project?.project?.id ?? '';
	const getHref = (project: any) => {
		const source = project?.source;
		const id = getId(project);
		if (!id) return '/zprojects';
		if (source === 'crm_deal') return `/project/${id}`;
		return `/zprojects/${id}`;
	};
	const getPreferredProjectDetailHref = (projectList: any[]) => {
		const preferred = (projectList || []).find((project) => {
			const id = getId(project);
			if (!id) return false;
			return project?.source !== 'crm_deal';
		});
		if (!preferred) return '';
		const id = getId(preferred);
		return id ? `/zprojects/${id}` : '';
	};
	const redirectToPreferredProject = (projectList: any[]) => {
		const href = getPreferredProjectDetailHref(projectList);
		if (!href) return false;
		void goto(href, { replaceState: true });
		return true;
	};
	const getName = (project: any) =>
		project?.name ?? project?.project_name ?? project?.Project_Name ?? 'Untitled Project';
	const getStatus = (project: any) => {
		const candidate = project?.status ?? project?.project_status ?? project?.Status ?? null;
		if (typeof candidate === 'string') return candidate;
		if (candidate && typeof candidate === 'object') {
			const name = candidate?.name ?? candidate?.display_value ?? candidate?.value ?? null;
			if (typeof name === 'string' && name.trim()) return name.trim();
		}
		return 'Unknown';
	};
	const getStartDate = (project: any) => project?.start_date ?? project?.start_date_string ?? null;
	const getEndDate = (project: any) => project?.end_date ?? project?.end_date_string ?? null;
	const getTaskCount = (project: any) => {
		const direct = toCount(project?.task_count ?? project?.tasks_count ?? project?.taskCount ?? null);
		if (direct !== null) return direct;
		const open = toCount(project?.tasks?.open_count ?? project?.tasks?.open ?? null);
		const closed = toCount(project?.tasks?.closed_count ?? project?.tasks?.closed ?? null);
		if (open === null && closed === null) return null;
		return (open ?? 0) + (closed ?? 0);
	};
	const getTaskCompletedCount = (project: any) =>
		project?.task_completed_count ??
		project?.completed_task_count ??
		project?.tasks_completed_count ??
		null;
	const getTaskPreview = (project: any) => (Array.isArray(project?.task_preview) ? project.task_preview : []);
	const getTaskPreviewName = (task: any) =>
		task?.name ?? task?.task_name ?? task?.Subject ?? task?.title ?? 'Untitled task';
	const getTaskPreviewStatus = (task: any) => task?.status ?? task?.task_status ?? 'Open';
	const isTaskPreviewCompleted = (task: any) =>
		Boolean(
			task?.completed === true ||
				String(task?.status ?? task?.task_status ?? '')
					.toLowerCase()
					.includes('complete')
		);

	function loadFromCache(): boolean {
		try {
			const raw = sessionStorage.getItem(CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw);
			if (Array.isArray(cached?.projects) && cached.projects.length > 0) {
				projects = cached.projects;
				return true;
			}
		} catch {
			/* ignore corrupt cache */
		}
		return false;
	}

	function saveToCache(data: ZProject[]) {
		try {
			sessionStorage.setItem(CACHE_KEY, JSON.stringify({ projects: data, ts: Date.now() }));
		} catch {
			/* storage full or unavailable */
		}
	}

	async function fetchProjects(isRefresh: boolean) {
		if (isRefresh) refreshing = true;
		try {
			const res = await fetch('/api/zprojects');
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = '/auth/portal';
					return;
				}
				const detail = await res.text().catch(() => '');
				throw new Error(detail || 'Failed to load projects');
			}

			const data = await res.json().catch(() => ({}));
			const fresh = data.projects || [];
			projects = fresh;
			if (redirectToPreferredProject(fresh)) return;
			saveToCache(fresh);
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
			if (redirectToPreferredProject(projects)) return;
			loading = false;
			fetchProjects(true);
		} else {
			fetchProjects(false);
		}
	});
</script>

<div class="zprojects">
	<nav class="back-nav">
		<a class="dashboard-btn" href="/dashboard">Dashboard</a>
	</nav>

	<header>
		<div>
			<h1>Projects</h1>
			<p>View your active Zoho Projects work.</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">Loading your projects...</div>
	{:else if error}
		<div class="error">
			<p>Error: {error}</p>
			<a href="/auth/portal">Please login again</a>
		</div>
	{:else if projects.length === 0}
		<div class="empty">
			<p>No active projects</p>
		</div>
	{:else}
		{#if refreshing}
			<div class="refreshing">Updating...</div>
		{/if}
		<section class="projects-section">
			<div class="projects-grid">
					{#each projects as project}
						<a class="project-card" href={getHref(project)}>
							<div class="project-info">
								<h3>{getName(project)}</h3>
								<p class="status">Status: {getStatus(project)}</p>
							<p class="date">
								Dates: {formatDate(getStartDate(project))} to {formatDate(getEndDate(project))}
							</p>
							<div class="meta">
								<span>Tasks: {getTaskCount(project) ?? '—'}</span>
								{#if getTaskCompletedCount(project) !== null && getTaskCount(project) !== null}
									<span>Completed: {getTaskCompletedCount(project)}/{getTaskCount(project)}</span>
								{/if}
							</div>
							{#if getTaskPreview(project).length > 0}
								<ul class="task-preview">
									{#each getTaskPreview(project) as task}
										<li class:done={isTaskPreviewCompleted(task)}>
											<span class="task-name">{getTaskPreviewName(task)}</span>
											<span class="task-state">{getTaskPreviewStatus(task)}</span>
										</li>
									{/each}
								</ul>
							{/if}
							</div>
							<div class="project-actions">
								<span class="btn-view">{project?.source === 'crm_deal' ? 'View Deal' : 'View Details'}</span>
							</div>
						</a>
					{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.zprojects {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	h1 {
		margin: 0 0 0.5rem;
	}

	.back-nav {
		margin-bottom: 1.5rem;
		display: flex;
		justify-content: flex-start;
	}

	.dashboard-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 0.9rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		min-height: 44px;
		color: #1a1a1a;
		text-decoration: none;
		font-size: 0.95rem;
	}

	.dashboard-btn:hover {
		background: #f3f4f6;
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

	.empty {
		padding: 2rem;
		border: 1px dashed #d1d5db;
		border-radius: 10px;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	.projects-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.25rem;
	}

	.project-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		text-decoration: none;
		color: inherit;
		min-height: 180px;
	}

	.project-card:hover {
		border-color: #cbd5e1;
		box-shadow: 0 10px 22px rgba(0, 0, 0, 0.06);
		transform: translateY(-1px);
		transition: 120ms ease;
	}

	.project-info h3 {
		margin: 0 0 0.5rem;
	}

	.status,
	.date {
		margin: 0.25rem 0;
		color: #4b5563;
	}

	.meta {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
		color: #374151;
		font-size: 0.95rem;
		flex-wrap: wrap;
	}

	.task-preview {
		margin: 0.9rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.4rem;
	}

	.task-preview li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: #374151;
		font-size: 0.92rem;
	}

	.task-preview li.done .task-name {
		text-decoration: line-through;
		color: #4b5563;
	}

	.task-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.task-state {
		color: #6b7280;
		flex-shrink: 0;
		font-size: 0.82rem;
	}

	.project-actions {
		display: flex;
		justify-content: flex-end;
	}

	.btn-view {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 0.9rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		min-height: 44px;
		color: #1a1a1a;
	}

	@media (max-width: 720px) {
		.zprojects {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
