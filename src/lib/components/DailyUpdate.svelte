<script lang="ts">
	import { onMount } from 'svelte';

	export let dealId: string;
	/** Hours of "recent" — defaults to 36 so an evening visit shows the next morning. */
	export let windowHours = 36;
	/**
	 * Which endpoint to call. Defaults to the client endpoint; trade or admin
	 * callers can pass a different builder if they want to reuse the panel.
	 */
	export let endpointBuilder: (id: string, hours: number) => string = (id, hours) =>
		`/api/client/daily-update/${encodeURIComponent(id)}?hours=${hours}`;

	interface DailyMessage {
		id: string;
		occurredAt: string;
		author: string | null;
		body: string;
		subject?: string | null;
		channel?: 'internal' | 'external' | 'mail' | 'field_update';
	}

	const CHANNEL_LABEL: Record<NonNullable<DailyMessage['channel']>, string> = {
		internal: 'Internal chat',
		external: 'Client chat',
		mail: 'Email',
		field_update: 'Field update'
	};
	interface DailyPhoto {
		id: string;
		name: string;
		url: string;
		modifiedTime: string | null;
	}

	let loading = true;
	let error = '';
	let messages: DailyMessage[] = [];
	let photos: DailyPhoto[] = [];
	let lightboxUrl: string | null = null;

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
			messages = Array.isArray(payload?.messages) ? payload.messages : [];
			photos = Array.isArray(payload?.photos) ? payload.photos : [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	onMount(() => load(dealId));
	$: if (dealId) load(dealId);

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

	function summarise(body: string, maxLen = 260): string {
		const clean = body.replace(/\s+/g, ' ').trim();
		return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
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
	{:else if messages.length === 0 && photos.length === 0}
		<p class="muted">No new updates in the last {windowHours} hours.</p>
	{:else}
		{#if photos.length > 0}
			<div class="photo-grid">
				{#each photos.slice(0, 12) as photo (photo.id)}
					<button
						type="button"
						class="thumb"
						title={`${photo.name}${photo.modifiedTime ? ` · ${formatTime(photo.modifiedTime)}` : ''}`}
						on:click={() => (lightboxUrl = photo.url)}
					>
						<img src={photo.url} alt={photo.name} loading="lazy" />
					</button>
				{/each}
			</div>
			{#if photos.length > 12}
				<p class="muted small">…and {photos.length - 12} more new photos in the project folder.</p>
			{/if}
		{/if}

		{#if messages.length > 0}
			<ul class="update-list">
				{#each messages.slice(0, 12) as m (m.id)}
					<li>
						<div class="row-head">
							<span class="author">{m.author || 'CPR team'}</span>
							<time>{formatTime(m.occurredAt)}</time>
						</div>
						{#if m.subject && m.channel === 'mail'}
							<p class="subject">{m.subject}</p>
						{/if}
						<p>{summarise(m.body)}</p>
					</li>
				{/each}
			</ul>
			{#if messages.length > 12}
				<p class="muted small">…plus {messages.length - 12} more updates from the team.</p>
			{/if}
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
	.row-head .author {
		font-weight: 600;
		color: #111827;
	}
	.row-meta {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}
	.channel-tag {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: #e5e7eb;
		color: #374151;
	}
	.channel-tag.channel-internal {
		background: #dbeafe;
		color: #1e40af;
	}
	.channel-tag.channel-external {
		background: #dcfce7;
		color: #166534;
	}
	.channel-tag.channel-mail {
		background: #fef3c7;
		color: #854d0e;
	}
	.channel-tag.channel-field_update {
		background: #ede9fe;
		color: #5b21b6;
	}
	.subject {
		font-weight: 600;
		font-size: 0.85rem;
		margin: 0.2rem 0 0.1rem;
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
