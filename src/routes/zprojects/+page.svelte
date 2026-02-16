<script lang="ts">
	import { onMount } from 'svelte';

	type ZProject = any;

	let projects = $state<ZProject[]>([]);
	let loading = $state(true);
	let error = $state('');

	const formatDate = (value: any) => {
		if (!value) return '—';
		const parsed = new Date(value);
		return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleDateString();
	};

	const getId = (project: any) =>
		project?.id ?? project?.project_id ?? project?.project?.id ?? '';
	const getName = (project: any) =>
		project?.name ?? project?.project_name ?? project?.Project_Name ?? 'Untitled Project';
	const getStatus = (project: any) =>
		project?.status ?? project?.project_status ?? project?.Status ?? 'Unknown';
	const getStartDate = (project: any) => project?.start_date ?? project?.start_date_string ?? null;
	const getEndDate = (project: any) => project?.end_date ?? project?.end_date_string ?? null;
	const getTaskCount = (project: any) =>
		project?.task_count ?? project?.tasks_count ?? project?.taskCount ?? null;
	const getMilestoneCount = (project: any) =>
		project?.milestone_count ?? project?.milestones_count ?? project?.milestoneCount ?? null;

	onMount(async () => {
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
			projects = data.projects || [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="zprojects">
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
		<section class="projects-section">
			<div class="projects-grid">
				{#each projects as project}
					<a class="project-card" href={`/zprojects/${getId(project)}`}>
						<div class="project-info">
							<h3>{getName(project)}</h3>
							<p class="status">Status: {getStatus(project)}</p>
							<p class="date">
								Dates: {formatDate(getStartDate(project))} to {formatDate(getEndDate(project))}
							</p>
							<div class="meta">
								<span>Tasks: {getTaskCount(project) ?? '—'}</span>
								<span>Milestones: {getMilestoneCount(project) ?? '—'}</span>
							</div>
						</div>
						<div class="project-actions">
							<span class="btn-view">View Details</span>
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
