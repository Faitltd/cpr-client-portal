<script lang="ts">
	import { onMount } from 'svelte';
	import {
		RESIDENTIAL_CHECKLIST,
		totalChecklistItems,
		type ChecklistPhase
	} from '$lib/data/residential-checklist';

	export let dealId: string;

	const phases: ChecklistPhase[] = RESIDENTIAL_CHECKLIST;
	const total = totalChecklistItems(phases);

	let checked = new Set<string>();
	let openPhase: string | null = phases[0]?.id ?? null;
	let loading = true;
	let saving = false;
	let saveError = '';
	let loadError = '';

	$: completed = checked.size;
	$: pct = total > 0 ? Math.round((completed / total) * 100) : 0;

	const phaseCounts = (phase: ChecklistPhase) => {
		const done = phase.items.filter((i) => checked.has(i.id)).length;
		return { done, total: phase.items.length };
	};

	onMount(async () => {
		if (!dealId) {
			loading = false;
			return;
		}
		try {
			const res = await fetch(`/api/client/checklist?deal_id=${encodeURIComponent(dealId)}`);
			if (res.ok) {
				const data = await res.json();
				checked = new Set<string>(Array.isArray(data?.checked_item_ids) ? data.checked_item_ids : []);
			} else {
				loadError = 'Progress could not be loaded; your changes still save as you go.';
			}
		} catch {
			loadError = 'Progress could not be loaded; your changes still save as you go.';
		} finally {
			loading = false;
		}
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const scheduleSave = () => {
		saveError = '';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
	};

	const save = async () => {
		if (!dealId) return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch('/api/client/checklist', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deal_id: dealId, checked_item_ids: [...checked] })
			});
			if (!res.ok) saveError = 'Could not save your progress. Please try again.';
		} catch {
			saveError = 'Could not save your progress. Please try again.';
		} finally {
			saving = false;
		}
	};

	const toggle = (id: string) => {
		if (checked.has(id)) checked.delete(id);
		else checked.add(id);
		checked = checked; // trigger reactivity
		scheduleSave();
	};

	const togglePhase = (id: string) => {
		openPhase = openPhase === id ? null : id;
	};
</script>

<div class="checklist">
	<div class="overview">
		<div class="progress-row">
			<span class="progress-label">{completed} of {total} complete</span>
			<span class="progress-pct">{pct}%</span>
		</div>
		<div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
			<div class="bar-fill" style={`width:${pct}%`}></div>
		</div>
		{#if saving}
			<span class="save-note">Saving…</span>
		{:else if saveError}
			<span class="save-note error">{saveError}</span>
		{:else if loadError}
			<span class="save-note error">{loadError}</span>
		{/if}
	</div>

	{#if loading}
		<p class="muted">Loading your checklist…</p>
	{:else}
		{#each phases as phase (phase.id)}
			{@const c = phaseCounts(phase)}
			<div class="phase" class:done={c.done === c.total}>
				<button class="phase-header" type="button" on:click={() => togglePhase(phase.id)}>
					<span class="phase-title">{phase.title}</span>
					<span class="phase-meta">
						<span class="phase-count">{c.done}/{c.total}</span>
						<span class="chev">{openPhase === phase.id ? '−' : '+'}</span>
					</span>
				</button>
				{#if openPhase === phase.id}
					<div class="phase-body">
						<p class="phase-summary">{phase.summary}</p>
						<ul class="items">
							{#each phase.items as item (item.id)}
								<li class="item" class:checked={checked.has(item.id)}>
									<label>
										<input
											type="checkbox"
											checked={checked.has(item.id)}
											on:change={() => toggle(item.id)}
										/>
										<span class="item-text">
											{item.text}
											{#if item.link}
												<a
													href={item.link.url}
													target="_blank"
													rel="noreferrer noopener"
													on:click|stopPropagation
													class="item-link">{item.link.label} ↗</a
												>
											{/if}
											{#if item.hint}
												<span class="item-hint">{item.hint}</span>
											{/if}
										</span>
									</label>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
		<p class="disclaimer">
			A general guide to keep your project on track. Your CPR team tailors the exact steps,
			order, and inspections to your home and local requirements.
		</p>
	{/if}
</div>

<style>
	.checklist {
		padding: 0.5rem 0.25rem 0.25rem;
	}

	.overview {
		margin-bottom: 1rem;
	}

	.progress-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 0.9rem;
		color: #44403c;
		margin-bottom: 0.35rem;
	}

	.progress-pct {
		font-weight: 700;
		color: #b3322c;
	}

	.bar {
		height: 8px;
		background: #f1e4e2;
		border-radius: 999px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: #b3322c;
		border-radius: 999px;
		transition: width 0.25s ease;
	}

	.save-note {
		display: inline-block;
		margin-top: 0.4rem;
		font-size: 0.78rem;
		color: #78716c;
	}
	.save-note.error {
		color: #b3322c;
	}

	.muted {
		color: #78716c;
		font-size: 0.9rem;
	}

	.phase {
		border: 1px solid #eee7e6;
		border-radius: 10px;
		margin-bottom: 0.55rem;
		overflow: hidden;
		background: #fff;
	}
	.phase.done .phase-count {
		color: #15803d;
		font-weight: 700;
	}

	.phase-header {
		width: 100%;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		background: #faf6f5;
		border: 0;
		cursor: pointer;
		font-size: 0.92rem;
		font-weight: 600;
		color: #1c1917;
		text-align: left;
		-webkit-tap-highlight-color: transparent;
	}
	.phase-header:hover {
		background: #f5eceb;
	}

	.phase-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		flex: 0 0 auto;
	}
	.phase-count {
		font-size: 0.82rem;
		color: #78716c;
	}
	.chev {
		font-size: 1.1rem;
		line-height: 1;
		color: #b3322c;
		width: 1rem;
		text-align: center;
	}

	.phase-body {
		padding: 0.4rem 0.9rem 0.8rem;
	}
	.phase-summary {
		margin: 0.35rem 0 0.6rem;
		font-size: 0.85rem;
		color: #78716c;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		padding: 0.35rem 0;
		border-top: 1px solid #f4efee;
	}
	.item:first-child {
		border-top: 0;
	}
	.item label {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		cursor: pointer;
	}
	.item input {
		margin-top: 0.2rem;
		width: 1.05rem;
		height: 1.05rem;
		accent-color: #b3322c;
		flex: 0 0 auto;
	}
	.item-text {
		font-size: 0.9rem;
		color: #292524;
		line-height: 1.4;
	}
	.item.checked .item-text {
		color: #a8a29e;
		text-decoration: line-through;
	}
	.item.checked .item-hint,
	.item.checked .item-link {
		text-decoration: none;
	}

	.item-link {
		display: inline-block;
		margin-left: 0.35rem;
		font-size: 0.82rem;
		color: #b3322c;
		white-space: nowrap;
	}
	.item-hint {
		display: block;
		font-size: 0.8rem;
		color: #a8a29e;
		margin-top: 0.1rem;
	}

	.disclaimer {
		margin-top: 0.75rem;
		font-size: 0.78rem;
		color: #a8a29e;
		line-height: 1.4;
	}
</style>
