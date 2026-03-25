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

	type DateGroup = {
		dateKey: string;
		label: string;
		photos: PhotoFile[];
	};

	let loading = true;
	let error = '';
	let allPhotos: PhotoFile[] = [];
	let dealName = '';
	let statusMessage = '';

	// Date filter state
	let filterFrom = '';
	let filterTo = '';

	// Lightbox state
	let lightboxOpen = false;
	let lightboxIndex = 0;
	let flatFiltered: PhotoFile[] = [];

	const projectId = $page.params.id;

	const parseDate = (value?: string | null): Date | null => {
		if (!value) return null;
		const d = new Date(value);
		return Number.isNaN(d.valueOf()) ? null : d;
	};

	const formatDateHeader = (dateKey: string): string => {
		const [y, m, d] = dateKey.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		return date.toLocaleDateString(undefined, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	};

	const formatDateShort = (value?: string | null): string => {
		if (!value) return '';
		const date = parseDate(value);
		if (!date) return value;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	const getDateKey = (photo: PhotoFile): string => {
		const date = parseDate(photo.createdTime);
		if (!date) return '0000-00-00';
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	};

	$: filteredPhotos = (() => {
		let photos = allPhotos;
		if (filterFrom) {
			const from = new Date(filterFrom + 'T00:00:00');
			photos = photos.filter((p) => {
				const d = parseDate(p.createdTime);
				return d ? d >= from : false;
			});
		}
		if (filterTo) {
			const to = new Date(filterTo + 'T23:59:59');
			photos = photos.filter((p) => {
				const d = parseDate(p.createdTime);
				return d ? d <= to : false;
			});
		}
		return photos;
	})();

	$: dateGroups = (() => {
		const map = new Map<string, PhotoFile[]>();
		for (const photo of filteredPhotos) {
			const key = getDateKey(photo);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(photo);
		}
		const groups: DateGroup[] = [];
		for (const [dateKey, photos] of map) {
			groups.push({
				dateKey,
				label: dateKey === '0000-00-00' ? 'Unknown Date' : formatDateHeader(dateKey),
				photos
			});
		}
		groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
		return groups;
	})();

	$: {
		flatFiltered = [];
		for (const group of dateGroups) {
			for (const photo of group.photos) {
				flatFiltered.push(photo);
			}
		}
	}

	$: lightboxPhoto = lightboxOpen && flatFiltered.length > 0 ? flatFiltered[lightboxIndex] : null;

	const openLightbox = (photo: PhotoFile) => {
		const idx = flatFiltered.indexOf(photo);
		if (idx >= 0) {
			lightboxIndex = idx;
			lightboxOpen = true;
		}
	};

	const closeLightbox = () => {
		lightboxOpen = false;
	};

	const lightboxPrev = () => {
		if (lightboxIndex > 0) lightboxIndex--;
	};

	const lightboxNext = () => {
		if (lightboxIndex < flatFiltered.length - 1) lightboxIndex++;
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (!lightboxOpen) return;
		if (e.key === 'Escape') closeLightbox();
		else if (e.key === 'ArrowLeft') lightboxPrev();
		else if (e.key === 'ArrowRight') lightboxNext();
	};

	const clearFilters = () => {
		filterFrom = '';
		filterTo = '';
	};

	const hasActiveFilter = () => filterFrom || filterTo;

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
			// If the CRM has an external share URL, redirect to WorkDrive directly.
			if (payload?.folderViewUrl && typeof payload.folderViewUrl === 'string') {
				window.location.replace(payload.folderViewUrl);
				return;
			}
			dealName = payload?.dealName || '';
			statusMessage = payload?.message || '';
			allPhotos = Array.isArray(payload?.files) ? payload.files : [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="container" style:visibility={loading ? 'hidden' : 'visible'}>
	<a class="back" href={`/project/${projectId}`}>← Back to Project</a>

	<header>
		<h1>Progress Photos</h1>
		{#if dealName}<p class="deal-name">{dealName}</p>{/if}
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
	{:else if allPhotos.length === 0}
		<div class="card empty-state">
			<div class="empty-icon">📷</div>
			<h2>No Photos Yet</h2>
			<p>Progress photos will appear here as your project moves forward. Check back soon!</p>
		</div>
	{:else}
		<div class="filter-bar card">
			<div class="filter-fields">
				<div class="filter-field">
					<label for="filter-from">From</label>
					<input id="filter-from" type="date" bind:value={filterFrom} />
				</div>
				<div class="filter-field">
					<label for="filter-to">To</label>
					<input id="filter-to" type="date" bind:value={filterTo} />
				</div>
				{#if hasActiveFilter()}
					<button class="btn-clear" on:click={clearFilters}>Show All</button>
				{/if}
			</div>
			<p class="photo-count">{filteredPhotos.length} photo{filteredPhotos.length !== 1 ? 's' : ''}</p>
		</div>

		{#if filteredPhotos.length === 0}
			<div class="card empty">
				<p>No photos match the selected date range.</p>
			</div>
		{:else}
			{#each dateGroups as group (group.dateKey)}
				<section class="date-section">
					<h2 class="date-header">{group.label}</h2>
					<div class="photo-grid">
						{#each group.photos as photo (photo.id)}
							<button class="photo-card" on:click={() => openLightbox(photo)} type="button">
								<div class="photo-frame">
									{#if photo.url}
										<img src={photo.url} alt={photo.name || 'Progress photo'} loading="lazy" />
									{:else}
										<span class="no-photo">No preview</span>
									{/if}
								</div>
								<div class="photo-meta">
									<span class="photo-name">{photo.name || 'Photo'}</span>
								</div>
							</button>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	{/if}
</div>

{#if lightboxOpen && lightboxPhoto}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="lightbox-backdrop" on:click={closeLightbox} role="dialog" aria-modal="true" aria-label="Photo viewer">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="lightbox-content" on:click|stopPropagation role="document">
			<button class="lightbox-close" on:click={closeLightbox} aria-label="Close">✕</button>

			<div class="lightbox-image-wrap">
				{#if lightboxIndex > 0}
					<button class="lightbox-nav lightbox-prev" on:click={lightboxPrev} aria-label="Previous photo">‹</button>
				{/if}

				<img src={lightboxPhoto.url} alt={lightboxPhoto.name || 'Photo'} class="lightbox-image" />

				{#if lightboxIndex < flatFiltered.length - 1}
					<button class="lightbox-nav lightbox-next" on:click={lightboxNext} aria-label="Next photo">›</button>
				{/if}
			</div>

			<div class="lightbox-info">
				<span class="lightbox-filename">{lightboxPhoto.name || 'Photo'}</span>
				{#if lightboxPhoto.createdTime}
					<span class="lightbox-date">{formatDateShort(lightboxPhoto.createdTime)}</span>
				{/if}
				<span class="lightbox-counter">{lightboxIndex + 1} / {flatFiltered.length}</span>
			</div>
		</div>
	</div>
{/if}

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

	.deal-name {
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

	.empty-state {
		text-align: center;
		padding: 3rem 1.5rem;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		background: #fff;
	}

	.empty-icon {
		font-size: 3rem;
		margin-bottom: 0.75rem;
	}

	.empty-state h2 {
		margin: 0 0 0.5rem;
		color: #111827;
		font-size: 1.3rem;
	}

	.empty-state p {
		margin: 0;
		color: #6b7280;
		max-width: 400px;
		margin-inline: auto;
		line-height: 1.5;
	}

	.status {
		color: #6b7280;
		font-weight: 600;
	}

	/* Filter bar */
	.filter-bar {
		margin-bottom: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.filter-fields {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}

	.filter-field {
		display: grid;
		gap: 0.3rem;
	}

	.filter-field label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #4b5563;
	}

	.filter-field input[type='date'] {
		padding: 0.5rem 0.6rem;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		font-size: 0.9rem;
		min-height: 38px;
	}

	.btn-clear {
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		color: #374151;
		cursor: pointer;
		min-height: 38px;
	}

	.btn-clear:hover {
		background: #e5e7eb;
	}

	.photo-count {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	/* Timeline sections */
	.date-section {
		margin-bottom: 2rem;
	}

	.date-header {
		font-size: 1.05rem;
		color: #111827;
		margin: 0 0 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 2px solid #e5e7eb;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
	}

	.photo-card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		overflow: hidden;
		cursor: pointer;
		padding: 0;
		text-align: left;
		transition: box-shadow 0.15s ease;
		font-family: inherit;
	}

	.photo-card:hover {
		box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
	}

	.photo-frame {
		width: 100%;
		height: 180px;
		overflow: hidden;
		background: #f9fafb;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.photo-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.no-photo {
		color: #9ca3af;
		font-size: 0.85rem;
	}

	.photo-meta {
		padding: 0.5rem 0.65rem;
	}

	.photo-name {
		font-size: 0.8rem;
		color: #4b5563;
		word-break: break-all;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Lightbox */
	.lightbox-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.lightbox-content {
		position: relative;
		max-width: 90vw;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.lightbox-close {
		position: absolute;
		top: -2.5rem;
		right: -0.5rem;
		background: none;
		border: none;
		color: #fff;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		z-index: 10;
	}

	.lightbox-close:hover {
		opacity: 0.8;
	}

	.lightbox-image-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.lightbox-image {
		max-width: 85vw;
		max-height: 75vh;
		object-fit: contain;
		border-radius: 6px;
	}

	.lightbox-nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.5);
		border: none;
		color: #fff;
		font-size: 2rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		border-radius: 6px;
		line-height: 1;
	}

	.lightbox-nav:hover {
		background: rgba(0, 0, 0, 0.7);
	}

	.lightbox-prev {
		left: -3.5rem;
	}

	.lightbox-next {
		right: -3.5rem;
	}

	.lightbox-info {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 0.75rem;
		color: #d1d5db;
		font-size: 0.9rem;
	}

	.lightbox-filename {
		font-weight: 600;
		color: #fff;
		word-break: break-all;
	}

	.lightbox-date {
		color: #9ca3af;
	}

	.lightbox-counter {
		color: #9ca3af;
		font-size: 0.85rem;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.photo-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.filter-bar {
			flex-direction: column;
			align-items: flex-start;
		}

		.lightbox-prev {
			left: 0.5rem;
		}

		.lightbox-next {
			right: 0.5rem;
		}

		.lightbox-image {
			max-width: 95vw;
		}

		.lightbox-nav {
			padding: 0.75rem;
			font-size: 1.5rem;
		}
	}
</style>
