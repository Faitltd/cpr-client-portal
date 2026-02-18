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

	const formatSize = (value?: number | null) => {
		if (!value || value <= 0) return '';
		if (value > 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
		if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
		return `${value} B`;
	};

	const formatDate = (value?: string | null) => {
		if (!value) return '';
		const date = new Date(value);
		return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
	};

	onMount(async () => {
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

<div class="photos-page">
	<nav class="back-nav">
		<a class="btn-link" href={`/project/${projectId}`}>Back to Project</a>
	</nav>

	<header>
		<h1>Progress Photos</h1>
		{#if dealName}
			<p>{dealName}</p>
		{/if}
	</header>

	{#if loading}
		<div class="loading">Loading photos…</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else if statusMessage}
		<div class="empty">{statusMessage}</div>
	{:else if photos.length === 0}
		<div class="empty">No photos found.</div>
	{:else}
		<div class="photo-grid">
			{#each photos as photo}
				<figure class="photo-card">
					<img src={photo.url} alt={photo.name} loading="lazy" />
					<figcaption>
						<div class="photo-name">{photo.name}</div>
						<div class="photo-meta">
							{#if formatDate(photo.createdTime)}
								<span>{formatDate(photo.createdTime)}</span>
							{/if}
							{#if formatSize(photo.size)}
								<span>{formatSize(photo.size)}</span>
							{/if}
						</div>
						<a class="photo-link" href={photo.url} target="_blank" rel="noreferrer">Open</a>
					</figcaption>
				</figure>
			{/each}
		</div>
	{/if}
</div>

<style>
	.photos-page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	.back-nav {
		margin-bottom: 1rem;
	}

	.btn-link {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.9rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		text-decoration: none;
		color: #1a1a1a;
		background: #fff;
		min-height: 40px;
	}

	.btn-link:hover {
		background: #f3f4f6;
	}

	header {
		margin-bottom: 1.5rem;
	}

	header h1 {
		margin: 0 0 0.25rem;
	}

	.loading,
	.error,
	.empty {
		padding: 1.5rem;
		border-radius: 10px;
		background: #fff;
		border: 1px solid #e5e7eb;
		color: #4b5563;
	}

	.error {
		border-color: #fecaca;
		background: #fff5f5;
		color: #b91c1c;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 1rem;
	}

	.photo-card {
		margin: 0;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		display: flex;
		flex-direction: column;
	}

	.photo-card img {
		width: 100%;
		height: 180px;
		object-fit: cover;
		background: #f8fafc;
	}

	figcaption {
		padding: 0.75rem 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.photo-name {
		font-weight: 600;
		color: #111827;
		font-size: 0.95rem;
	}

	.photo-meta {
		font-size: 0.82rem;
		color: #6b7280;
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.photo-link {
		font-size: 0.85rem;
		text-decoration: none;
		color: #2563eb;
	}

	.photo-link:hover {
		text-decoration: underline;
	}
</style>
