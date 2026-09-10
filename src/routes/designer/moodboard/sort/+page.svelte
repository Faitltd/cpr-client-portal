<script lang="ts">
	export let data: {
		colors: Array<{
			id: string;
			name: string;
			boards: Array<{ id: string; src: number; tag: string; img: string }>;
		}>;
		tags: Record<string, string>;
	};

	let tags: Record<string, string> = { ...data.tags };
	let saving: Record<string, boolean> = {};
	let error = '';

	const CATS = [
		{ key: 'wood', label: 'Wood' },
		{ key: 'dark', label: 'Dark' },
		{ key: 'light', label: 'Light' }
	];

	const thumb = (u: string, w = 260) =>
		!u || u.indexOf('/object/public/') < 0
			? u
			: u.replace('/object/public/', '/render/image/public/') + `?width=${w}&quality=72&resize=contain`;

	async function setTag(id: string, counter: string) {
		const prev = tags[id];
		const next = prev === counter ? '' : counter; // click the active one to clear
		const t = { ...tags };
		if (next) t[id] = next;
		else delete t[id];
		tags = t;
		saving = { ...saving, [id]: true };
		error = '';
		try {
			const r = await fetch('/designer/moodboard/tag', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ board_id: id, counter: next })
			});
			if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as any).message || 'save failed');
		} catch (e) {
			const t2 = { ...tags };
			if (prev) t2[id] = prev;
			else delete t2[id];
			tags = t2;
			error = `Could not save ${id}: ${(e as Error).message}`;
		} finally {
			saving = { ...saving, [id]: false };
		}
	}

	const done = (c: (typeof data.colors)[number]) => c.boards.filter((b) => tags[b.id]).length;
	const total = data.colors.reduce((n, c) => n + c.boards.length, 0);
	$: totalDone = data.colors.reduce((n, c) => n + c.boards.filter((b) => tags[b.id]).length, 0);
</script>

<svelte:head><title>Sort Boards by Countertop</title></svelte:head>

<div class="sortpage">
	<header class="head">
		<div>
			<h1>Sort by Countertop</h1>
			<p class="sub">
				Tap the countertop tone under each board — <b>Wood</b>, <b>Dark</b>, or <b>Light</b>. Saves as
				you go. The client mood board groups each color by these tags. Tap the active one again to clear it.
			</p>
		</div>
		<div class="stat">
			<span class="n">{totalDone}</span><span class="l">/ {total} tagged</span>
			<a class="back" href="/designer/moodboard">Back to selections</a>
		</div>
	</header>

	{#if error}<div class="err">{error}</div>{/if}

	{#each data.colors as c (c.id)}
		<section class="color">
			<div class="color-head">
				<h2>{c.name}</h2>
				<span class="prog">{done(c)} / {c.boards.length}</span>
			</div>
			<div class="grid">
				{#each c.boards as b (b.id)}
					<figure class="board" class:untagged={!tags[b.id]}>
						<div class="imgwrap">
							<img src={thumb(b.img)} alt={`Board ${b.src}${b.tag}`} loading="lazy" />
							<span class="bid">{b.src}{b.tag}</span>
						</div>
						<div class="btns" role="group" aria-label={`Countertop for ${b.src}${b.tag}`}>
							{#each CATS as cat}
								<button
									class="cat {cat.key}"
									class:on={tags[b.id] === cat.key}
									disabled={saving[b.id]}
									on:click={() => setTag(b.id, cat.key)}>{cat.label}</button>
							{/each}
						</div>
					</figure>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.sortpage {
		max-width: 1180px;
		margin: 0 auto;
		padding: 1.25rem 1rem 5rem;
		color: #1f2937;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}
	.head h1 {
		margin: 0 0 0.3rem;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
		max-width: 68ch;
	}
	.stat {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 0.6rem 0.9rem;
	}
	.stat .n {
		font-size: 1.35rem;
		font-weight: 700;
	}
	.stat .l {
		color: #6b7280;
		font-size: 0.85rem;
	}
	.stat .back {
		margin-left: 0.75rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #a9744f;
		text-decoration: none;
	}
	.err {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
		padding: 0.6rem 0.85rem;
		border-radius: 10px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}
	.color {
		margin-bottom: 1.75rem;
	}
	.color-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 0.4rem;
		margin-bottom: 0.9rem;
		position: sticky;
		top: 0;
		background: #fff;
		z-index: 1;
	}
	.color-head h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
	}
	.prog {
		font-size: 0.82rem;
		color: #6b7280;
		font-variant-numeric: tabular-nums;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.8rem;
	}
	.board {
		margin: 0;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}
	.board.untagged {
		border-color: #f0c9a8;
		box-shadow: 0 0 0 2px rgba(214, 158, 110, 0.18);
	}
	.imgwrap {
		position: relative;
		background: #eceff3;
	}
	.imgwrap img {
		width: 100%;
		aspect-ratio: 3 / 2;
		object-fit: cover;
		display: block;
	}
	.bid {
		position: absolute;
		left: 6px;
		top: 6px;
		font-size: 0.7rem;
		font-weight: 600;
		color: #fff;
		background: rgba(0, 0, 0, 0.55);
		border-radius: 5px;
		padding: 1px 6px;
		font-variant-numeric: tabular-nums;
	}
	.btns {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
	}
	.cat {
		border: none;
		border-top: 1px solid #eef0f2;
		border-right: 1px solid #eef0f2;
		background: #fff;
		padding: 0.5rem 0.2rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
	}
	.cat:last-child {
		border-right: none;
	}
	.cat:hover {
		background: #f7f4ee;
		color: #1f2937;
	}
	.cat.on.wood {
		background: #b07d54;
		color: #fff;
	}
	.cat.on.dark {
		background: #2a2a2d;
		color: #fff;
	}
	.cat.on.light {
		background: #d7dade;
		color: #1f2937;
	}
	.cat:disabled {
		opacity: 0.5;
		cursor: default;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		}
	}
</style>
