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
	let wifiInput = '';
	let doorCodeInput = '';
	let updateMessage = '';
	let updateError = '';
	let updating = false;
	const getProgressPhotosLink = (deal: any) => {
		const dealId = String(deal?.id || $page.params.id || '').trim();
		if (!dealId) return '';
		return `/api/project/${encodeURIComponent(dealId)}/progress-photos`;
	};

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
			wifiInput = project?.WiFi || '';
			doorCodeInput = project?.Garage_Code || '';

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

	const submitAccessInfo = async () => {
		updateMessage = '';
		updateError = '';
		const wifi = wifiInput.trim();
		const doorCode = doorCodeInput.trim();
		if (!wifi || !doorCode) {
			updateError = 'WiFi and Door code are required.';
			return;
		}
		if (wifi.length > 200) {
			updateError = 'WiFi must be 200 characters or less.';
			return;
		}
		if (doorCode.length > 100) {
			updateError = 'Door code must be 100 characters or less.';
			return;
		}

		updating = true;
		try {
			const res = await fetch(`/api/project/${projectId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ wifi, garageCode: doorCode })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				updateError = payload?.message || 'Failed to update access info.';
				return;
			}
			updateMessage = payload?.message || 'Access info updated.';
			project = { ...project, WiFi: wifi, Garage_Code: doorCode };
		} catch {
			updateError = 'Failed to update access info.';
		} finally {
			updating = false;
		}
	};
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
					{#if getProgressPhotosLink(project)}
						<a href={getProgressPhotosLink(project)} target="_blank" rel="noreferrer">View Photos</a>
					{:else}
						<p>Not available</p>
					{/if}
				</div>
			</div>
			<div class="access-card">
				<h3>Update Access Info</h3>
				<div class="access-form">
					<div>
						<label for="wifi">WiFi</label>
						<input id="wifi" type="text" bind:value={wifiInput} placeholder="WiFi details" />
					</div>
					<div>
						<label for="door-code">Door code</label>
						<input
							id="door-code"
							type="text"
							bind:value={doorCodeInput}
							placeholder="Door code"
						/>
					</div>
					<div class="access-actions">
						<button class="btn-view" type="button" on:click={submitAccessInfo} disabled={updating}>
							{updating ? 'Saving...' : 'Save Access Info'}
						</button>
					</div>
					{#if updateMessage}
						<p class="update-message">{updateMessage}</p>
					{/if}
					{#if updateError}
						<p class="update-error">{updateError}</p>
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
									<a class="btn-view" href={`/contracts/${contract.id}/sign`}>
										Sign
									</a>
								{/if}
								{#if contract.view_url}
									<a
										class="btn-secondary"
										href={`/contracts/${contract.id}/view?url=${encodeURIComponent(contract.view_url)}`}
									>
										View
									</a>
								{:else}
									<a class="btn-secondary" href={`/contracts/${contract.id}/view`}>
										View
									</a>
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

	.access-card {
		margin-top: 1.5rem;
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.access-form {
		display: grid;
		gap: 1rem;
		max-width: 520px;
	}

	.access-form label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.4rem;
	}

	.access-form input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		min-height: 44px;
	}

	.access-actions {
		display: flex;
		justify-content: flex-start;
	}

	.update-message {
		color: #166534;
		margin: 0;
	}

	.update-error {
		color: #b91c1c;
		margin: 0;
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
		min-height: 44px;
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
		min-height: 44px;
	}

	.btn-secondary:hover {
		background: #e9e9e9;
	}

	.documents ul {
		list-style: none;
		padding: 0;
	}

	.documents a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	.documents li {
		padding: 1rem;
		border-bottom: 1px solid #ddd;
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
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

	@media (max-width: 720px) {
		.project-detail {
			padding: 1.5rem 1.25rem;
		}

		nav {
			margin-bottom: 1.25rem;
		}

		header {
			margin-bottom: 1.5rem;
		}

		.info-grid {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}

		.contract-card {
			flex-direction: column;
			align-items: flex-start;
		}

		.contract-actions {
			justify-content: flex-start;
			width: 100%;
		}

		.btn-view,
		.btn-secondary {
			width: 100%;
			text-align: center;
		}

		.documents li {
			flex-direction: column;
			align-items: flex-start;
		}

		.access-card {
			padding: 1.25rem;
		}

		.access-actions {
			width: 100%;
		}
	}
</style>
