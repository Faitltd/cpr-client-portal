<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let project: any = null;
	let documents: any[] = [];
	let notes: any[] = [];
	let loading = true;
	let error = '';

	const projectId = $page.params.id;

	onMount(async () => {
		try {
			const response = await fetch(`/api/project/${projectId}`);
			if (!response.ok) {
				if (response.status === 403) {
					error = 'You do not have permission to view this project';
				} else {
					throw new Error('Failed to fetch project');
				}
				return;
			}
			const data = await response.json();
			project = data.deal;
			documents = data.documents;
			notes = data.notes;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="project-detail">
	<nav>
		<a href="/dashboard">← Back to Projects</a>
	</nav>

	{#if loading}
		<div class="loading">Loading project details...</div>
	{:else if error}
		<div class="error">
			<p>{error}</p>
			<a href="/dashboard">Return to Dashboard</a>
		</div>
	{:else if project}
		<header>
			<h1>{project.Deal_Name}</h1>
			<p class="stage">Stage: {project.Stage}</p>
		</header>

		<section class="overview">
			<div class="info-grid">
				<div>
					<h3>Closing Date</h3>
					<p>{project.Closing_Date ? new Date(project.Closing_Date).toLocaleDateString() : 'TBD'}</p>
				</div>
				<div>
					<h3>Project Manager</h3>
					<p>{project.Owner?.name || 'Not assigned'}</p>
				</div>
				<div>
					<h3>Progress Photos</h3>
					{#if project.External_Link}
						<a href={project.External_Link} target="_blank" rel="noreferrer">View Photos</a>
					{:else}
						<p>Not available</p>
					{/if}
				</div>
			</div>
			{#if project.Description}
				<div class="description">
					<h3>Description</h3>
					<p>{project.Description}</p>
				</div>
			{/if}
		</section>

		{#if documents.length > 0}
			<section class="documents">
				<h2>Documents</h2>
				<ul>
					{#each documents as doc}
						<li>
							<a href={doc.File_Name} download>{doc.File_Name}</a>
							<span class="date">{new Date(doc.Created_Time).toLocaleDateString()}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if notes.length > 0}
			<section class="timeline">
				<h2>Project Timeline</h2>
				<div class="notes">
					{#each notes as note}
						<div class="note">
							<p class="note-date">{new Date(note.Created_Time).toLocaleDateString()}</p>
							<p class="note-content">{note.Note_Content}</p>
							<p class="note-author">— {note.Owner?.name}</p>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.project-detail {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem;
	}

	nav {
		margin-bottom: 2rem;
	}

	nav a {
		color: #0066cc;
		text-decoration: none;
	}

	header {
		margin-bottom: 2rem;
	}

	h1 {
		margin-bottom: 0.5rem;
	}

	.stage {
		color: #666;
		font-size: 1.1rem;
	}

	section {
		margin-bottom: 3rem;
	}

	.info-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 2rem;
		margin-bottom: 2rem;
	}

	.info-grid h3 {
		margin-bottom: 0.5rem;
		color: #666;
		font-size: 0.9rem;
		text-transform: uppercase;
	}

	.description {
		padding: 1.5rem;
		background: #f5f5f5;
		border-radius: 8px;
	}

	.documents ul {
		list-style: none;
		padding: 0;
	}

	.documents li {
		padding: 1rem;
		border-bottom: 1px solid #ddd;
		display: flex;
		justify-content: space-between;
	}

	.date {
		color: #666;
	}

	.notes {
		display: grid;
		gap: 1rem;
	}

	.note {
		padding: 1.5rem;
		background: #f9f9f9;
		border-left: 4px solid #0066cc;
		margin-bottom: 1rem;
		border-radius: 4px;
	}

	.note-date {
		font-size: 0.9rem;
		color: #666;
		margin-bottom: 0.5rem;
	}

	.note-content {
		margin-bottom: 0.5rem;
	}

	.note-author {
		font-style: italic;
		color: #666;
	}

	.loading, .error {
		text-align: center;
		padding: 3rem;
	}

	.error {
		color: #c00;
	}
</style>
