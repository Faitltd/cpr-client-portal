<script lang="ts">
	import { onMount } from 'svelte';
	import { renderMarkdown } from '$lib/markdown';

	export let dealId: string;
	/** Retained for back-compat with other callers; no longer used for display. */
	export let windowHours = 36;
	/**
	 * Which endpoint to call. Defaults to the client endpoint, which returns the
	 * LATEST progress (server-side lookback) rather than a fixed window. Trade or
	 * admin callers can pass a different builder to reuse the panel.
	 */
	export let endpointBuilder: (id: string, hours: number) => string = (id) =>
		`/api/client/daily-update/${encodeURIComponent(id)}`;

	interface DailyPhoto {
		id: string;
		name: string;
		url: string;
		modifiedTime: string | null;
	}

	let loading = true;
	let error = '';
	let summary = '';
	let photos: DailyPhoto[] = [];
	let asOf: string | null = null;
	let lightboxUrl: string | null = null;

	const asOfLabel = (iso: string | null) => {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	};

	async function load(id: string) {
		if (!id) return;
		loading = true;
		error = '';
		try {
			const res = await fetch(endpointBuilder(id, windowHours));
			if (!res.ok) {
				const detail = await res.json().catch(() => null);
				throw new Error(detail?.message ?? `HTTP ${res.status}`);
			}
			const payload = await res.json();
			summary = typeof payload?.summary === 'string' ? payload.summary : '';
			photos = Array.isArray(payload?.photos) ? payload.photos : [];
			asOf = typeof payload?.asOf === 'string' ? payload.asOf : null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	onMount(() => load(dealId));
	$: if (dealId) load(dealId);
</script>

<section class="daily-card">
	<header class="card-head">
		<h3>Project status</h3>
		{#if asOf}<span class="window-note">as of {asOfLabel(asOf)}</span>{/if}
	</header>

	{#if loading}
		<p class="muted">Loading recent activity…</p>
	{:else if error}
		<p class="error">Couldn't load updates: {error}</p>
	{:else}
		{#if photos.length > 0}
			<div class="photo-grid">
				{#each photos.slice(0, 4) as photo (photo.id)}
					<button
						type="button"
						class="thumb"
						title={photo.name}
						on:click={() => (lightboxUrl = photo.url)}
					>
						<img src={photo.url} alt={photo.name} loading="lazy" />
					</button>
				{/each}
			</div>
		{/if}

		{#if summary}
			<div class="summary">{@html renderMarkdown(summary)}</div>
		{:else if photos.length === 0}
			<p class="muted">No recent updates yet — your team posts progress here as work moves.</p>
		{/if}
	{/if}
</section>

{#if lightboxUrl}
	<button class="lightbox" type="button" on:click={() => (lightboxUrl = null)}>
		<img src={lightboxUrl} alt="enlarged site photo" />
	</button>
{/if}

<style>
	.daily-card {
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		padding: 1rem;
		margin: 1rem 0;
	}
	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.card-head h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.window-note {
		font-size: 0.75rem;
		color: #6b7280;
	}
	.photo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.4rem;
		margin: 0.5rem 0 0.75rem;
	}
	.thumb {
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		border-radius: 0.4rem;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.summary {
		font-size: 0.95rem;
		line-height: 1.45;
		color: #111827;
	}
	.summary :global(ul) {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
	}
	.summary :global(li) {
		margin-bottom: 0.35rem;
	}
	.summary :global(p) {
		margin: 0 0 0.5rem;
	}
	.summary :global(strong) {
		font-weight: 600;
	}
	.muted {
		color: #6b7280;
	}
	.error {
		color: #b91c1c;
	}
	.small {
		font-size: 0.8rem;
	}
	.lightbox {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		padding: 0;
		z-index: 9999;
		cursor: zoom-out;
	}
	.lightbox img {
		max-width: 95vw;
		max-height: 95vh;
		object-fit: contain;
	}
</style>
