<script lang="ts">
	import DealCard from '$lib/components/designer/DealCard.svelte';
	import type { DesignerDealSummary } from '$lib/types/designer';
	import type { PageData } from './$types';

	export let data: PageData;

	// Keep a local copy of deals so in-session edits don't mutate load data
	// (which SvelteKit may re-use across invalidations). Re-seed when the
	// loader returns a new deals array.
	let deals: DesignerDealSummary[] = data.deals;
	$: deals = data.deals;

	let query = '';
	let stageFilter = '';

	$: stages = Array.from(
		new Set(deals.map((d) => d.stage).filter((s): s is string => typeof s === 'string' && s.length > 0))
	).sort();

	$: filtered = deals.filter((deal) => {
		if (stageFilter && deal.stage !== stageFilter) return false;
		if (!query.trim()) return true;
		const needle = query.trim().toLowerCase();
		const hay = [
			deal.name,
			deal.stage,
			deal.contactName,
			deal.accountName,
			deal.address,
			deal.ballInCourt
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return hay.includes(needle);
	});

	function onDealUpdated(event: CustomEvent<{ dealId: string; fields: Record<string, unknown> }>) {
		const { dealId, fields } = event.detail;
		deals = deals.map((deal) => (deal.id === dealId ? { ...deal, fields } : deal));
	}
</script>

<svelte:head>
	<title>Designer · CPR Portal</title>
</svelte:head>

<main class="page">
	<header class="page-header">
		<div>
			<h1>Designer dashboard</h1>
			<p class="muted">
				Signed in as <strong>{data.designer?.name ?? data.designer?.email ?? 'Designer'}</strong> ·
				<a href="/api/logout">Sign out</a>
			</p>
		</div>
		<div class="filters" role="search">
			<label class="sr-only" for="deal-search">Search deals</label>
			<input
				id="deal-search"
				type="search"
				placeholder="Search deals, clients, addresses…"
				bind:value={query}
			/>
			<label class="sr-only" for="stage-filter">Filter by stage</label>
			<select id="stage-filter" bind:value={stageFilter}>
				<option value="">All stages</option>
				{#each stages as stage}
					<option value={stage}>{stage}</option>
				{/each}
			</select>
		</div>
	</header>

	{#if data.warning}
		<p class="banner error" role="alert">{data.warning}</p>
	{/if}

	<section aria-label="Deals" class="deals">
		{#if deals.length === 0 && !data.warning}
			<p class="muted empty">No deals found.</p>
		{:else if filtered.length === 0}
			<p class="muted empty">No deals match the current filter.</p>
		{:else}
			{#each filtered as deal (deal.id)}
				<DealCard
					{deal}
					fieldDescriptors={data.fieldDescriptors}
					on:dealUpdated={onDealUpdated}
				/>
			{/each}
		{/if}
	</section>
</main>

<style>
	.page {
		max-width: 1120px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
		display: grid;
		gap: 1.25rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #0f172a;
	}

	.muted {
		color: #6b7280;
	}

	.filters {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.filters input,
	.filters select {
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		font: inherit;
		min-width: 200px;
	}

	.deals {
		display: grid;
		gap: 0.75rem;
	}

	.banner.error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		margin: 0;
	}

	.empty {
		padding: 2rem 0;
		text-align: center;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 720px) {
		.filters input,
		.filters select {
			min-width: 0;
			flex: 1;
		}
	}
</style>
