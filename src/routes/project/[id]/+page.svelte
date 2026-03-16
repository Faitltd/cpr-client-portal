<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { formatCrmRichText } from '$lib/html';

	let project: any = null;
	let documents: any[] = [];
	let notes: any[] = [];
	let loading = true;
	let error = '';
	let wifiInput = '';
	let doorCodeInput = '';
	let updateMessage = '';
	let updateError = '';
	let updating = false;
	const getProgressPhotosLink = (deal: any) => {
		// Prefer the direct WorkDrive external share link stored in the CRM field.
		// This opens the WorkDrive folder view directly, same as trade partner links.
		const crmLink = deal?.Client_Portal_Folder || deal?.External_Link;
		if (typeof crmLink === 'string' && /^https?:\/\//i.test(crmLink.trim())) {
			return crmLink.trim();
		}
		// Fall back to the custom proxy photos page if no direct link is set.
		const dealId = String(deal?.id || $page.params.id || '').trim();
		if (!dealId) return '';
		return `/project/${encodeURIComponent(dealId)}/photos`;
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
				const signRequests = (await contractsRes.json()).data || [];

				// Add completed/signed Zoho Sign documents to the documents list
				// so they appear in the Documents section with working PDF download links
				for (const c of signRequests) {
					if (c.id && /complete|signed/i.test(c.status || '')) {
						documents = [
							...documents,
							{
								id: c.id,
								File_Name: `${c.name || 'Signed Document'}.pdf`,
								Created_Time: c.created_time || new Date().toISOString(),
								_source: 'sign'
							}
						];
					}
				}
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
	<div class="back-nav">
		<a href="/dashboard">← Back to Projects</a>
	</div>

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
					<p class="scope-text">{formatCrmRichText(project.Refined_SOW) || 'Not available'}</p>
				</div>
				<div>
					<h3>Progress Photos</h3>
					{#if getProgressPhotosLink(project)}
						{@const photosLink = getProgressPhotosLink(project)}
						<a
							href={photosLink}
							target={photosLink.startsWith('http') ? '_blank' : undefined}
							rel={photosLink.startsWith('http') ? 'noreferrer' : undefined}
						>View Photos</a>
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

		{#if documents.length > 0}
			<section class="documents">
				<h2>Documents</h2>
				<ul>
					{#each documents as doc}
						<li>
							{#if doc._source === 'sign'}
							<a href={`/api/sign/requests/${doc.id}/pdf`} target="_blank">{doc.File_Name}</a>
						{:else}
							<a href={`/api/project/${projectId}/documents/${doc.id}?fileName=${encodeURIComponent(doc.File_Name)}`} target="_blank">{doc.File_Name}</a>
						{/if}
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

	.back-nav {
		margin-bottom: 2rem;
	}

	.back-nav a {
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

	.scope-text {
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
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

		.back-nav {
			margin-bottom: 1.25rem;
		}

		header {
			margin-bottom: 1.5rem;
		}

		.info-grid {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}

		.btn-view {
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
