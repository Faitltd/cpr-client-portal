<script lang="ts">
	import { onMount } from 'svelte';

	export let dealId: string;
	/** Hours of "recent" — defaults to 36 so an evening visit shows the next morning. */
	export let windowHours = 36;

	interface FieldUpdate {
		id: string;
		createdAt: string | null;
		updatedAt: string | null;
		type: string | null;
		body: string | null;
		photos: Array<{ name: string; url: string }>;
	}

	let loading = true;
	let error = '';
	let updates: FieldUpdate[] = [];
	let lightboxUrl: string | null = null;

	// Only positive progress. Skip problems, issues, schedule changes, and
	// change orders — those have their own escalation paths and don't belong
	// in the "good news at a glance" panel.
	const SKIP_TYPES = new Set([
		'report_problem',
		'problem',
		'issue',
		'schedule_change',
		'change_order'
	]);
	const NEGATIVE_BODY_RE =
		/\b(problem|issue|broken|damag(e|ed|es)|delay(ed|s)?|fail(ed|ure|s)?|cracked|leak(ed|ing|s)?|missing|wrong|incorrect|holdup|stuck|blocked|concern|risk|hazard|injury|accident)\b/i;

	$: cutoff = Date.now() - windowHours * 60 * 60 * 1000;
	$: recent = updates
		.filter((u) => {
			const t = Date.parse(u.createdAt ?? u.updatedAt ?? '');
			if (!Number.isFinite(t) || t < cutoff) return false;
			const type = (u.type ?? '').toLowerCase().trim();
			if (SKIP_TYPES.has(type)) return false;
			if (u.body && NEGATIVE_BODY_RE.test(u.body)) return false;
			return true;
		})
		.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
	$: allPhotos = recent.flatMap((u) => u.photos.map((p) => ({ ...p, postedAt: u.createdAt })));

	async function loadUpdates(id: string) {
		if (!id) return;
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(id)}/field-updates`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const payload = await res.json();
			updates = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	onMount(() => loadUpdates(dealId));
	$: if (dealId) loadUpdates(dealId);

	function formatTime(iso: string | null): string {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			return d.toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	function summarise(body: string | null, maxLen = 220): string {
		if (!body) return '';
		const oneLine = body.replace(/\s+/g, ' ').trim();
		return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
	}
</script>

<section class="daily-card">
	<header class="card-head">
		<h3>Today on site</h3>
		<span class="window-note">Last {windowHours}h</span>
	</header>

	{#if loading}
		<p class="muted">Loading recent activity…</p>
	{:else if error}
		<p class="error">Couldn't load updates: {error}</p>
	{:else if recent.length === 0}
		<p class="muted">No field updates in the last {windowHours} hours.</p>
	{:else}
		{#if allPhotos.length > 0}
			<div class="photo-grid">
				{#each allPhotos.slice(0, 12) as photo (photo.url)}
					<button
						type="button"
						class="thumb"
						title={`Posted ${formatTime(photo.postedAt)}`}
						on:click={() => (lightboxUrl = photo.url)}
					>
						<img src={photo.url} alt={photo.name || 'site photo'} loading="lazy" />
					</button>
				{/each}
			</div>
			{#if allPhotos.length > 12}
				<p class="muted small">…and {allPhotos.length - 12} more photos in the latest field updates.</p>
			{/if}
		{/if}

		<ul class="update-list">
			{#each recent as u (u.id)}
				<li>
					<div class="row-head">
						<span class="type">{u.type || 'Update'}</span>
						<time>{formatTime(u.createdAt)}</time>
					</div>
					{#if u.body}
						<p>{summarise(u.body)}</p>
					{/if}
					{#if u.photos.length > 0}
						<p class="muted small">{u.photos.length} photo{u.photos.length === 1 ? '' : 's'}</p>
					{/if}
				</li>
			{/each}
		</ul>
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
	.update-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.update-list li {
		border-top: 1px solid #f3f4f6;
		padding-top: 0.5rem;
	}
	.row-head {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: #6b7280;
	}
	.row-head .type {
		font-weight: 600;
		color: #111827;
	}
	.update-list p {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
		line-height: 1.4;
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
