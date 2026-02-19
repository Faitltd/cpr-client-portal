<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
		import { page } from '$app/stores';

	type TradePhoto = {
		id: string;
		projectName: string;
		workType: string;
		submittedAt: string;
		url: string;
		caption?: string;
	};

	type PhotoGroup = {
		projectName: string;
		photos: TradePhoto[];
	};

	let photos: TradePhoto[] = [];
	let loading = true;
	let error = '';

	const formatDate = (value: string) => {
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return value;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	const groupPhotos = (items: TradePhoto[]): PhotoGroup[] => {
		const groups = new Map<string, TradePhoto[]>();
		for (const photo of items) {
			const key = photo.projectName || 'Other Projects';
			const existing = groups.get(key);
			if (existing) {
				existing.push(photo);
			} else {
				groups.set(key, [photo]);
			}
		}
		return Array.from(groups.entries()).map(([projectName, groupPhotos]) => ({
			projectName,
			photos: groupPhotos
		}));
	};

	$: groupedPhotos = groupPhotos(photos);

	onMount(async () => {
		loading = true;
		error = '';
		try {
			const dealId = $page.url.searchParams.get('dealId');
			const query = dealId ? `?dealId=${encodeURIComponent(dealId)}` : '';
			const res = await fetch(`/api/trade/photos${query}`);
			if (res.status === 401) {
				goto('/auth/trade');
				return;
			}
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = payload?.message || 'Unable to load progress photos.';
				photos = [];
				return;
			}
			photos = Array.isArray(payload?.photos) ? payload.photos : [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unable to load progress photos.';
			photos = [];
		} finally {
			loading = false;
		}
	});
</script>

<div class="container">
	<a class="back" href="/trade/dashboard">← Back to Dashboard</a>

	<header>
		<h1>Progress Photos</h1>
		<p>Review recent photo submissions across your active projects.</p>
	</header>

	{#if loading}
		<p class="status">Loading progress photos...</p>
	{:else if error}
		<div class="card error">
			<p>{error}</p>
		</div>
	{:else if groupedPhotos.length === 0}
		<div class="card empty">
			<p>No progress photos have been submitted yet.</p>
		</div>
	{:else}
		<div class="groups">
			{#each groupedPhotos as group}
				<section class="project-group">
					<h2>{group.projectName}</h2>
					<div class="photo-grid">
						{#each group.photos as photo (photo.id)}
							<article class="photo-card">
								<div class="photo-meta">
									<span class="work-type">{photo.workType}</span>
									<span class="date">{formatDate(photo.submittedAt)}</span>
								</div>
								<div class="photo-frame">
									<img
										src={photo.url}
										alt={photo.caption || photo.projectName}
										loading="lazy"
									/>
								</div>
								{#if photo.caption}
									<p class="caption">{photo.caption}</p>
								{/if}
							</article>
						{/each}
					</div>
				</section>
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

	.groups {
		display: grid;
		gap: 2rem;
	}

	.project-group h2 {
		margin: 0 0 1rem;
		font-size: 1.25rem;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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

	.work-type {
		font-weight: 700;
		color: #111827;
	}

	.date {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.photo-frame {
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.photo-frame img {
		display: block;
		width: 100%;
		height: 180px;
		object-fit: cover;
	}

	.caption {
		color: #374151;
		font-size: 0.95rem;
		margin: 0;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.photo-frame img {
			height: 160px;
		}
	}
</style>
