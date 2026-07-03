<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();

	interface ChecklistItem {
		id: number;
		seq: number;
		item: string;
		completed: boolean;
		completedBy: string | null;
		completedAt: string | null;
	}

	interface TradeChecklist {
		id: number;
		name: string;
		items: ChecklistItem[];
		done: number;
		total: number;
	}

	let checklists = $state<TradeChecklist[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let openTrade = $state<string | null>(null);
	let saving = $state<Set<number>>(new Set());

	const pct = (done: number, total: number) =>
		total === 0 ? 0 : Math.round((done / total) * 100);

	async function loadChecklists() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/trade/checklists/${encodeURIComponent(data.projectId)}`);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message || `Failed to load (${res.status})`);
			}
			const payload = await res.json();
			checklists = payload.checklists || [];
			const params = new URLSearchParams(window.location.search);
			const wanted = params.get('trade');
			openTrade =
				(wanted && checklists.find((t) => t.name === wanted)?.name) ||
				checklists[0]?.name ||
				null;
		} catch (err: any) {
			loadError = err?.message || 'Failed to load checklists.';
		} finally {
			loading = false;
		}
	}

	async function toggleItem(trade: TradeChecklist, item: ChecklistItem) {
		if (saving.has(item.id)) return;
		saving = new Set(saving).add(item.id);

		const next = !item.completed;
		// Optimistic update
		item.completed = next;
		item.completedBy = next ? data.tradePartner?.name || data.tradePartner?.email || null : null;
		item.completedAt = next ? new Date().toISOString() : null;
		trade.done = trade.items.filter((i) => i.completed).length;

		try {
			const res = await fetch(`/api/trade/checklists/${encodeURIComponent(data.projectId)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, completed: next })
			});
			if (!res.ok) throw new Error('Save failed');
		} catch {
			// Roll back on failure
			item.completed = !next;
			item.completedBy = null;
			item.completedAt = null;
			trade.done = trade.items.filter((i) => i.completed).length;
		} finally {
			const s = new Set(saving);
			s.delete(item.id);
			saving = s;
		}
	}

	onMount(loadChecklists);
</script>

<svelte:head>
	<title>QC Checklists</title>
</svelte:head>

<div class="qc-page">
	<a class="back" href={`/trade/projects/${encodeURIComponent(data.projectId)}`}>← Back to Project</a>

	<header>
		<h1>Trade QC Checklists</h1>
		<p class="sub">Check off each item as work is completed. Progress saves automatically.</p>
	</header>

	{#if loading}
		<p class="state-msg">Loading checklists…</p>
	{:else if loadError}
		<p class="state-msg error">{loadError}</p>
		<button class="retry" onclick={loadChecklists}>Retry</button>
	{:else}
		{#each checklists as trade (trade.id)}
			<section class="trade" class:open={openTrade === trade.name}>
				<button
					type="button"
					class="trade-header"
					onclick={() => (openTrade = openTrade === trade.name ? null : trade.name)}
				>
					<span class="name">{trade.name}</span>
					<span class="progress-wrap">
						<span class="progress-bar">
							<span
								class="progress-fill"
								class:complete={trade.done === trade.total && trade.total > 0}
								style="width: {pct(trade.done, trade.total)}%"
							></span>
						</span>
						<span class="count">{trade.done}/{trade.total}</span>
					</span>
				</button>

				{#if openTrade === trade.name}
					<ul class="items">
						{#each trade.items as item (item.id)}
							<li class:done={item.completed}>
								<button
									type="button"
									class="check"
									disabled={saving.has(item.id)}
									aria-pressed={item.completed}
									onclick={() => toggleItem(trade, item)}
								>
									<span class="box">{item.completed ? '✓' : ''}</span>
									<span class="label">{item.item}</span>
								</button>
								{#if item.completed && item.completedBy}
									<span class="meta">
										{item.completedBy}
										{#if item.completedAt}
											· {new Date(item.completedAt).toLocaleDateString()}
										{/if}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.qc-page {
		max-width: 860px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
	}
	.back {
		display: inline-block;
		margin-bottom: 1rem;
		color: #2563eb;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.back:hover {
		text-decoration: underline;
	}
	header {
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.4rem;
		margin: 0;
	}
	.sub {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
	.state-msg {
		color: #6b7280;
		padding: 1rem 0;
	}
	.state-msg.error {
		color: #b91c1c;
	}
	.retry {
		padding: 0.5rem 1rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
	}
	.trade {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		margin-bottom: 0.6rem;
		overflow: hidden;
		background: #fff;
	}
	.trade-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		padding: 0.85rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
	}
	.trade.open .trade-header {
		border-bottom: 1px solid #e5e7eb;
	}
	.name {
		font-weight: 600;
	}
	.progress-wrap {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 180px;
	}
	.progress-bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: #e5e7eb;
		overflow: hidden;
	}
	.progress-fill {
		display: block;
		height: 100%;
		background: #3b82f6;
		transition: width 0.2s ease;
	}
	.progress-fill.complete {
		background: #22c55e;
	}
	.count {
		font-size: 0.8rem;
		color: #6b7280;
		min-width: 3.2rem;
		text-align: right;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0.25rem 0;
	}
	.items li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0 1rem;
	}
	.items li + li {
		border-top: 1px solid #f3f4f6;
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		padding: 0.55rem 0;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		font: inherit;
		width: 100%;
	}
	.check:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.box {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		border: 1.5px solid #9ca3af;
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		color: #fff;
		margin-top: 0.1rem;
	}
	li.done .box {
		background: #22c55e;
		border-color: #22c55e;
	}
	li.done .label {
		color: #9ca3af;
		text-decoration: line-through;
	}
	.label {
		line-height: 1.35;
		font-size: 0.92rem;
	}
	.meta {
		flex: none;
		font-size: 0.72rem;
		color: #9ca3af;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.progress-wrap {
			min-width: 110px;
		}
		.meta {
			display: none;
		}
	}
</style>
