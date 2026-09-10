<script lang="ts">
	import { onMount } from 'svelte';

	export let data: {
		clients: Array<{
			key: string;
			count: number;
			notes: number;
			lastUpdated: string | null;
			items: Array<{
				board_id: string;
				favorite: boolean;
				note: string | null;
				updated_at: string;
				colorName: string;
				styleName: string;
				label: string;
				img: string;
			}>;
		}>;
		loadError?: string;
	};

	const thumb = (url: string, w = 300) =>
		!url || url.indexOf('/object/public/') < 0
			? url
			: url.replace('/object/public/', '/render/image/public/') + `?width=${w}&quality=72&resize=contain`;

	const fmt = (iso: string | null) => {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return '';
		}
	};

	const totalBoards = data.clients.reduce((n, c) => n + c.count, 0);

	// Client link generator: key = first name + house number (e.g. Ray6565 -> ray6565)
	let firstName = '';
	let houseNo = '';
	let origin = '';
	let copied = false;
	onMount(() => {
		origin = window.location.origin;
	});
	$: key = (firstName + houseNo).toLowerCase().replace(/[^a-z0-9_-]/g, '');
	$: link = (origin || '') + '/moodboard?c=' + key;
	async function copyLink() {
		if (!key) return;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			// clipboard blocked; the link is shown for manual copy
		}
	}
</script>

<svelte:head><title>Mood Board Selections</title></svelte:head>

<div class="mb-admin">
	<header class="head">
		<div>
			<h1>Mood Board Selections</h1>
			<p class="sub">
				What each client has hearted and noted. Send a client their board with a link like
				<code>/moodboard?c=their-name</code>.
			</p>
			<a class="sortlink" href="/designer/moodboard/sort">Sort boards by countertop &rarr;</a>
		</div>
		<div class="stat">
			<span class="n">{data.clients.length}</span>
			<span class="l">client{data.clients.length === 1 ? '' : 's'}</span>
			<span class="n">{totalBoards}</span>
			<span class="l">saved boards</span>
		</div>
	</header>

	<section class="linkgen">
		<h2>Create a client link</h2>
		<p class="lg-sub">
			Send this to the client before the site visit so they can favorite and note what they like.
			The key is their first name + house number, for example <code>Ray6565</code>.
		</p>
		<div class="lg-row">
			<label>First name<input type="text" bind:value={firstName} placeholder="Ray" autocomplete="off" /></label>
			<label>House number<input type="text" inputmode="numeric" bind:value={houseNo} placeholder="6565" autocomplete="off" /></label>
		</div>
		{#if key}
			<div class="lg-out">
				<code class="lg-link">{link}</code>
				<button class="lg-copy" on:click={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button>
				<a class="lg-open" href={link} target="_blank" rel="noreferrer">Open ↗</a>
			</div>
		{/if}
	</section>

	{#if data.loadError}
		<div class="err">Couldn't load selections: {data.loadError}</div>
	{/if}

	{#if data.clients.length === 0}
		<div class="empty">
			<p>No client selections yet.</p>
			<p class="hint">
				Share a link such as <code>/moodboard?c=johnson</code> with a client. Everything they
				favorite or note there shows up on this page.
			</p>
		</div>
	{:else}
		{#each data.clients as client (client.key)}
			<section class="client">
				<div class="client-head">
					<div class="who">
						<h2>{client.key}</h2>
						<span class="meta">
							{client.count} board{client.count === 1 ? '' : 's'}
							{#if client.notes}· {client.notes} note{client.notes === 1 ? '' : 's'}{/if}
							{#if client.lastUpdated}· updated {fmt(client.lastUpdated)}{/if}
						</span>
					</div>
					<a class="openlink" href={`/moodboard?c=${encodeURIComponent(client.key)}`} target="_blank" rel="noreferrer">
						Open their board ↗
					</a>
				</div>

				<div class="grid">
					{#each client.items as item (item.board_id)}
						<figure class="board" class:hasnote={!!(item.note && item.note.trim())}>
							{#if item.img}
								<img src={thumb(item.img)} alt={`${item.styleName} ${item.label}`} loading="lazy" />
							{:else}
								<div class="noimg">{item.label}</div>
							{/if}
							<figcaption>
								<div class="cap-top">
									<span class="cap-style">{item.styleName}</span>
									<span class="cap-id">{item.label}</span>
								</div>
								<span class="cap-color">{item.colorName}</span>
								{#if item.note && item.note.trim()}
									<p class="note">{item.note}</p>
								{/if}
							</figcaption>
						</figure>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

<style>
	.mb-admin {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
		color: #1f2937;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}
	.head h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.3rem;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
		max-width: 60ch;
	}
	.sortlink {
		display: inline-block;
		margin-top: 0.7rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #a9744f;
		text-decoration: none;
		border: 1px solid #e7d9cb;
		background: #faf5ef;
		padding: 0.4rem 0.8rem;
		border-radius: 9px;
	}
	.sortlink:hover {
		border-color: #a9744f;
	}
	code {
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 5px;
		padding: 0.05rem 0.35rem;
		font-size: 0.85em;
	}
	.stat {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.1rem 0.6rem;
		align-items: baseline;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 0.7rem 1rem;
	}
	.stat .n {
		font-size: 1.25rem;
		font-weight: 700;
		text-align: right;
	}
	.stat .l {
		color: #6b7280;
		font-size: 0.85rem;
	}
	.linkgen {
		border: 1px solid #e7d9cb;
		background: #faf7f2;
		border-radius: 14px;
		padding: 1.1rem 1.2rem 1.2rem;
		margin-bottom: 1.4rem;
	}
	.linkgen h2 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.lg-sub {
		margin: 0 0 0.9rem;
		color: #6b7280;
		font-size: 0.88rem;
		max-width: 66ch;
	}
	.lg-row {
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	.lg-row label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
	}
	.lg-row input {
		height: 40px;
		min-width: 180px;
		padding: 0 0.7rem;
		border: 1px solid #d1d5db;
		border-radius: 9px;
		font-size: 0.95rem;
		background: #fff;
	}
	.lg-row input:focus {
		outline: none;
		border-color: #a9744f;
		box-shadow: 0 0 0 3px rgba(169, 116, 79, 0.18);
	}
	.lg-out {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.9rem;
	}
	.lg-link {
		flex: 1;
		min-width: 240px;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 9px;
		padding: 0.55rem 0.7rem;
		font-size: 0.85rem;
		color: #374151;
		overflow-x: auto;
		white-space: nowrap;
	}
	.lg-copy {
		height: 40px;
		padding: 0 1rem;
		border-radius: 9px;
		border: none;
		background: #a9744f;
		color: #fff;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.lg-copy:hover {
		background: #96643f;
	}
	.lg-open {
		height: 40px;
		display: inline-flex;
		align-items: center;
		padding: 0 0.85rem;
		border-radius: 9px;
		border: 1px solid #e7d9cb;
		background: #fff;
		color: #a9744f;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
	}

	.err {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		margin-bottom: 1rem;
	}
	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 14px;
		padding: 2.5rem 1.5rem;
		text-align: center;
		color: #6b7280;
	}
	.empty p {
		margin: 0.25rem 0;
	}
	.empty .hint {
		font-size: 0.9rem;
	}

	.client {
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		background: #fff;
		padding: 1.1rem 1.1rem 1.3rem;
		margin-bottom: 1.4rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}
	.client-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.who h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
		text-transform: capitalize;
	}
	.who .meta {
		color: #6b7280;
		font-size: 0.85rem;
	}
	.openlink {
		font-size: 0.85rem;
		font-weight: 600;
		color: #a9744f;
		text-decoration: none;
		border: 1px solid #e7d9cb;
		background: #faf5ef;
		padding: 0.45rem 0.8rem;
		border-radius: 9px;
		white-space: nowrap;
	}
	.openlink:hover {
		border-color: #a9744f;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 0.9rem;
	}
	.board {
		margin: 0;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
		background: #f9fafb;
		display: flex;
		flex-direction: column;
	}
	.board.hasnote {
		border-color: #e7d9cb;
		box-shadow: 0 0 0 2px rgba(169, 116, 79, 0.15);
	}
	.board img,
	.board .noimg {
		width: 100%;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		display: block;
		background: #eceff3;
	}
	.board .noimg {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #9ca3af;
		font-weight: 600;
	}
	figcaption {
		padding: 0.55rem 0.65rem 0.7rem;
	}
	.cap-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.cap-style {
		font-weight: 600;
		font-size: 0.85rem;
		line-height: 1.2;
	}
	.cap-id {
		font-size: 0.72rem;
		color: #9ca3af;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cap-color {
		display: block;
		font-size: 0.75rem;
		color: #6b7280;
		margin-top: 0.1rem;
	}
	.note {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		line-height: 1.4;
		color: #374151;
		background: #faf5ef;
		border-left: 3px solid #a9744f;
		border-radius: 0 6px 6px 0;
		padding: 0.4rem 0.55rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		}
	}
</style>
