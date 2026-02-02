<script lang="ts">
	import { onMount } from 'svelte';

	let projects: any[] = [];
	let loading = true;
	let error = '';

	onMount(async () => {
		try {
			const response = await fetch('/api/projects');
			if (!response.ok) throw new Error('Failed to fetch projects');
			const data = await response.json();
			projects = data.data || [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="dashboard">
	<header>
		<h1>My Projects</h1>
		<p>View and manage your renovation projects</p>
	</header>

	{#if loading}
		<div class="loading">Loading your projects...</div>
	{:else if error}
		<div class="error">
			<p>Error: {error}</p>
			<a href="/auth/login">Please login again</a>
		</div>
	{:else if projects.length === 0}
		<div class="empty">
			<p>No projects found</p>
		</div>
	{:else}
		<div class="projects-grid">
			{#each projects as project}
				<div class="project-card">
					<h3>{project.Deal_Name || 'Untitled Project'}</h3>
					<p class="status">Status: {project.Stage || 'Unknown'}</p>
					<p class="amount">Amount: ${project.Amount?.toLocaleString() || '0'}</p>
					<p class="date">Created: {new Date(project.Created_Time).toLocaleDateString()}</p>
					<a href="/project/{project.id}" class="btn-view">View Details</a>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.loading, .error, .empty {
		text-align: center;
		padding: 3rem;
		background: #f5f5f5;
		border-radius: 8px;
	}

	.error {
		color: #c00;
	}

	.projects-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.project-card {
		padding: 1.5rem;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: white;
	}

	.project-card h3 {
		margin-bottom: 1rem;
		color: #1a1a1a;
	}

	.status, .amount, .date {
		margin: 0.5rem 0;
		color: #666;
	}

	.btn-view {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
	}

	.btn-view:hover {
		background: #0052a3;
	}
</style>