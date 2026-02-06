<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let project: any = null;
	let documents: any[] = [];
	let notes: any[] = [];
	let contracts: any[] = [];
	let loading = true;
	let error = '';
	let contractError = '';

	const projectId = $page.params.id;

	onMount(async () => {
		try {
			const [projectRes, contractsRes] = await Promise.all([
				fetch(`/api/project/${projectId}`),
				fetch('/api/sign/requests')
			]);
			if (!projectRes.ok) {
				if (projectRes.status === 403) {
					error = 'You do not have permission to view this project';
				} else {
					throw new Error('Failed to fetch project');
				}
				return;
			}
			const data = await projectRes.json();
			project = data.deal;
			documents = data.documents;
			notes = data.notes;

			if (contractsRes.ok) {
				const contractsData = await contractsRes.json();
				contracts = contractsData.data || [];
			} else if (contractsRes.status !== 401) {
				contractError = 'Failed to fetch contracts';
			}
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
					<h3>Scope</h3>
					<p>{project.Refined_SOW || 'Not available'}</p>
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

		<section class="contracts">
			<h2>Contracts</h2>
			{#if contractError}
				<p class="section-error">{contractError}</p>
			{:else if contracts.length === 0}
				<p class="section-empty">No contracts found.</p>
			{:else}
				<div class="contract-list">
					{#each contracts as contract}
						<div class="contract-card">
							<div>
								<h3>{contract.name}</h3>
								<p class="contract-meta">Status: {contract.status || 'Unknown'}</p>
							</div>
							<div class="contract-actions">
								{#if contract.can_sign}
									<a class="btn-view" href={`/contracts/${contract.id}/sign`}>Sign</a>
								{/if}
								{#if contract.view_url}
									<a
										class="btn-secondary"
										href={`/contracts/${contract.id}/view?url=${encodeURIComponent(contract.view_url)}`}
									>
										View
									</a>
								{:else}
									<a class="btn-secondary" href={`/contracts/${contract.id}/view`}>View</a>
								{/if}
							</div>
						</div>
					{/each}
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

	.contract-list {
		display: grid;
		gap: 1rem;
	}

	.contract-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: #fff;
	}

	.contract-meta {
		color: #666;
		margin: 0.3rem 0 0;
	}

	.contract-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.section-error {
		color: #c00;
	}

	.btn-view {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
	}

	.btn-view:hover {
		background: #0052a3;
	}

	.btn-secondary {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
		border-radius: 4px;
		border: 1px solid #d0d0d0;
	}

	.btn-secondary:hover {
		background: #e9e9e9;
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
