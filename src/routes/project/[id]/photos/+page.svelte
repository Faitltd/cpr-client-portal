<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	type PhotoFile = {
		id: string;
		name: string;
		url: string;
		size?: number | null;
		mime?: string | null;
		createdTime?: string | null;
	};

	let loading = true;
	let error = '';
	let photos: PhotoFile[] = [];
	let dealName = '';
	let statusMessage = '';

	const projectId = $page.params.id;

	const formatDate = (value?: string | null) => {
		if (!value) return '';
		const date = new Date(value);
		return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	onMount(async () => {
		if (!projectId) {
			error = 'Missing project id.';
			loading = false;
			return;
		}
		try {
			const res = await fetch(`/api/project/${encodeURIComponent(projectId)}/photos`);
			if (!res.ok) {
				if (res.status === 401) {
					error = 'Please login again.';
					return;
				}
				const detail = await res.text().catch(() => '');
				throw new Error(detail || 'Failed to load photos');
			}
			const payload = await res.json();
			// If the API resolved a public WorkDrive folder URL, redirect there directly —
			// same experience as the trade partner "Progress Photos" link.
			if (payload?.folderViewUrl && /^https?:\/\//i.test(String(payload.folderViewUrl))) {
				window.location.replace(payload.folderViewUrl);
				return;
			}
			dealName = payload?.dealName || '';
			statusMessage = payload?.message || '';
			photos = Array.isArray(payload?.files) ? payload.files : [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="container">
	<a class="back" href={`/project/${projectId}`}>← Back to Project</a>

	<header>
		<h1>Progress Photos</h1>
		{#if dealName}<p>{dealName}</p>{/if}
	</header>

	{#if loading}
		<p class="status">Loading progress photos...</p>
	{:else if error}
		<div class="card error">
			<p>{error}</p>
		</div>
	{:else if statusMessage}
		<div class="card empty">
			<p>{statusMessage}</p>
		</div>
	{:else if photos.length === 0}
		<div class="card empty">
			<p>No progress photos have been submitted yet.</p>
		</div>
	{:else}
		<div class="photo-grid">
			{#each photos as photo (photo.id)}
				<article class="photo-card">
					<div class="photo-meta">
						<span class="photo-name">{photo.name || 'Photo'}</span>
						{#if formatDate(photo.createdTime)}
							<span class="date">{formatDate(photo.createdTime)}</span>
						{/if}
					</div>
					{#if photo.url}
						<a class="photo-frame" href={photo.url} target="_blank" rel="noreferrer">
							<img src={photo.url} alt={photo.name || 'Progress photo'} loading="lazy" />
						</a>
					{:else}
						<div class="photo-frame empty-frame">
							<span>No photo available</span>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin: 1rem 0 2rem;
	}

	h1 {
		margin-bottom: 0.4rem;
	}

	p {
		margin: 0;
		color: #4b5563;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: #0066cc;
		text-decoration: none;
		font-weight: 600;
	}

	.back:hover {
		text-decoration: underline;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.card.error {
		border-color: #fecaca;
		background: #fff5f5;
		color: #b91c1c;
	}

	.card.empty {
		color: #6b7280;
	}

	.status {
		color: #6b7280;
		font-weight: 600;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 1rem;
	}

	.photo-card {
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		padding: 1rem;
		display: grid;
		gap: 0.75rem;
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
	}

	.photo-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.photo-name {
		font-weight: 700;
		color: #111827;
		font-size: 0.9rem;
		word-break: break-all;
	}

	.date {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.photo-frame {
		display: block;
		width: 100%;
		height: 180px;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.photo-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.empty-frame {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.empty-frame span {
		color: #9ca3af;
		font-size: 0.9rem;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
