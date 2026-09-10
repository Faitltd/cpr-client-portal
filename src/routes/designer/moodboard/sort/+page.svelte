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

	// Full-screen viewer for sorting
	$: allBoards = data.colors.flatMap((c) => c.boards.map((b) => ({ ...b, color: c.name })));
	let lbIndex = -1;
	$: lbBoard = lbIndex >= 0 ? allBoards[lbIndex] : null;
	const openLb = (id: string) => (lbIndex = allBoards.findIndex((x) => x.id === id));
	const closeLb = () => (lbIndex = -1);
	const lbPrev = () => { if (lbIndex > 0) lbIndex -= 1; };
	const lbNext = () => { if (lbIndex < allBoards.length - 1) lbIndex += 1; };
	function onKey(e: KeyboardEvent) {
		if (lbIndex < 0 || !lbBoard) return;
		const k = e.key.toLowerCase();
		if (e.key === 'Escape') closeLb();
		else if (e.key === 'ArrowLeft') lbPrev();
		else if (e.key === 'ArrowRight') lbNext();
		else if (k === 'w') setTag(lbBoard.id, 'wood');
		else if (k === 'd') setTag(lbBoard.id, 'dark');
		else if (k === 'l') setTag(lbBoard.id, 'light');
	}
</script>

<svelte:window on:keydown={onKey} />

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
						<button type="button" class="imgwrap" on:click={() => openLb(b.id)} title="Open full screen">
							<img src={thumb(b.img)} alt={`Board ${b.src}${b.tag}`} loading="lazy" />
							<span class="bid">{b.src}{b.tag}</span>
							<span class="expand" aria-hidden="true">⤢</span>
						</button>
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

	{#if lbBoard}
		<div class="lb" on:click={(e) => { if (e.target === e.currentTarget) closeLb(); }}>
			<div class="lb-card">
				<div class="lb-head">
					<span class="lb-color">{lbBoard.color}</span>
					<span class="lb-id">{lbBoard.src}{lbBoard.tag}</span>
					<span class="lb-count">{lbIndex + 1} / {allBoards.length}</span>
					<span class="sp"></span>
					<button class="lb-x" on:click={closeLb} aria-label="Close">✕</button>
				</div>
				<div class="lb-img"><img src={lbBoard.img} alt={`Board ${lbBoard.src}${lbBoard.tag}`} /></div>
				<div class="lb-foot">
					<button class="navbtn" disabled={lbIndex === 0} on:click={lbPrev}>‹ Prev</button>
					<div class="lb-cats">
						{#each CATS as cat}
							<button
								class="cat {cat.key}"
								class:on={tags[lbBoard.id] === cat.key}
								on:click={() => setTag(lbBoard.id, cat.key)}>{cat.label}</button>
						{/each}
					</div>
					<button class="navbtn" disabled={lbIndex === allBoards.length - 1} on:click={lbNext}>Next ›</button>
				</div>
			</div>
		</div>
	{/if}
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
		display: block;
		width: 100%;
		border: none;
		padding: 0;
		background: #eceff3;
		cursor: zoom-in;
	}
	.imgwrap .expand {
		position: absolute;
		right: 6px;
		top: 6px;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 5px;
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		font-size: 0.8rem;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.imgwrap:hover .expand {
		opacity: 1;
	}

	/* full-screen viewer */
	.lb {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(20, 20, 25, 0.82);
		padding: 20px;
	}
	.lb-card {
		background: #fff;
		border-radius: 14px;
		overflow: hidden;
		max-width: min(1100px, 96vw);
		max-height: 94vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}
	.lb-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border-bottom: 1px solid #eef0f2;
	}
	.lb-color {
		font-weight: 700;
	}
	.lb-id,
	.lb-count {
		font-size: 0.8rem;
		color: #6b7280;
		font-variant-numeric: tabular-nums;
	}
	.lb-head .sp {
		flex: 1;
	}
	.lb-x {
		border: none;
		background: none;
		font-size: 1.05rem;
		cursor: pointer;
		color: #6b7280;
		padding: 4px 8px;
	}
	.lb-img {
		background: #f3f4f6;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: auto;
	}
	.lb-img img {
		max-width: 100%;
		max-height: 78vh;
		display: block;
	}
	.lb-foot {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-top: 1px solid #eef0f2;
	}
	.lb-cats {
		display: flex;
		gap: 8px;
		flex: 1;
		justify-content: center;
		flex-wrap: wrap;
	}
	.lb-cats .cat {
		border: 1px solid #e5e7eb;
		border-radius: 9px;
		padding: 0.55rem 1.2rem;
		font-weight: 600;
		font-size: 0.9rem;
		color: #6b7280;
		background: #fff;
		cursor: pointer;
	}
	.lb-cats .cat.on.wood {
		background: #b07d54;
		color: #fff;
		border-color: #b07d54;
	}
	.lb-cats .cat.on.dark {
		background: #2a2a2d;
		color: #fff;
		border-color: #2a2a2d;
	}
	.lb-cats .cat.on.light {
		background: #d7dade;
		color: #1f2937;
		border-color: #c7ccd1;
	}
	.navbtn {
		border: 1px solid #e5e7eb;
		background: #fff;
		border-radius: 9px;
		padding: 0.55rem 0.9rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.navbtn:disabled {
		opacity: 0.4;
		cursor: default;
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
		.lb {
			padding: 0;
		}
		.lb-card {
			max-width: 100vw;
			max-height: 100dvh;
			height: 100dvh;
			border-radius: 0;
		}
		.lb-img {
			flex: 1;
		}
		.lb-img img {
			max-height: none;
		}
		.lb-cats .cat {
			padding: 0.5rem 0.7rem;
		}
	}
</style>
