<script lang="ts">
	// Collapsible QC checklist for one trade, rendered under that trade's
	// task group in the trade dashboard Tasks tab. Data comes from
	// /api/trade/checklists/:projectId (Supabase qc_* tables).
	export let trade: any;
	export let saving: Set<number> = new Set();
	export let onToggle: (trade: any, item: any) => void;

	let open = false;

	$: pctVal = trade?.total ? Math.round((trade.done / trade.total) * 100) : 0;
</script>

<div class="qc-checklist" class:open>
	<button type="button" class="qc-header" on:click={() => (open = !open)}>
		<span class="qc-title">
			<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path d="M4 10l4 4 8-8" />
			</svg>
			QC Checklist{trade.name ? ` — ${trade.name}` : ''}
		</span>
		<span class="qc-progress">
			<span class="qc-bar">
				<span
					class="qc-fill"
					class:complete={trade.done === trade.total && trade.total > 0}
					style="width:{pctVal}%"
				></span>
			</span>
			<span class="qc-count">{trade.done}/{trade.total}</span>
			<span class="qc-chevron" class:flipped={open}>▾</span>
		</span>
	</button>

	{#if open}
		<ul class="qc-items">
			{#each trade.items as item (item.id)}
				<li class:done={item.completed}>
					<button
						type="button"
						class="qc-item"
						disabled={saving.has(item.id)}
						on:click={() => onToggle(trade, item)}
					>
						<span class="qc-box">{item.completed ? '✓' : ''}</span>
						<span class="qc-label">{item.item}</span>
					</button>
					{#if item.completed && item.completedBy}
						<span class="qc-meta">{item.completedBy}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.qc-checklist {
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		margin: 0.35rem 0 0.75rem;
		background: #f8fafc;
		overflow: hidden;
	}
	.qc-checklist.open {
		background: #fff;
	}
	.qc-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.55rem 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
	}
	.qc-checklist.open .qc-header {
		border-bottom: 1px solid #e2e8f0;
	}
	.qc-title {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #334155;
	}
	.qc-title svg {
		color: #16a34a;
	}
	.qc-progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 150px;
	}
	.qc-bar {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: #e2e8f0;
		overflow: hidden;
	}
	.qc-fill {
		display: block;
		height: 100%;
		background: #3b82f6;
		transition: width 0.2s ease;
	}
	.qc-fill.complete {
		background: #22c55e;
	}
	.qc-count {
		font-size: 0.75rem;
		color: #64748b;
		min-width: 3rem;
		text-align: right;
	}
	.qc-chevron {
		font-size: 0.75rem;
		color: #94a3b8;
		transition: transform 0.15s ease;
	}
	.qc-chevron.flipped {
		transform: rotate(180deg);
	}
	.qc-items {
		list-style: none;
		margin: 0;
		padding: 0.15rem 0;
	}
	.qc-items li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0 0.75rem;
	}
	.qc-items li + li {
		border-top: 1px solid #f1f5f9;
	}
	.qc-item {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.45rem 0;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		font: inherit;
		width: 100%;
	}
	.qc-item:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.qc-box {
		flex: none;
		width: 1rem;
		height: 1rem;
		border: 1.5px solid #94a3b8;
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		color: #fff;
		margin-top: 0.1rem;
		background: #fff;
	}
	li.done .qc-box {
		background: #22c55e;
		border-color: #22c55e;
	}
	li.done .qc-label {
		color: #94a3b8;
		text-decoration: line-through;
	}
	.qc-label {
		line-height: 1.3;
		font-size: 0.83rem;
		color: #334155;
	}
	.qc-meta {
		flex: none;
		font-size: 0.68rem;
		color: #94a3b8;
		white-space: nowrap;
	}
</style>
