<script lang="ts">
	import { page } from '$app/stores';
	import DealCard from '$lib/components/designer/DealCard.svelte';
	import {
		DESIGNER_VIEW_TABS,
		filterDesignerDealsForView,
		getDesignerEmptyMessageForView,
		type DesignerViewKey
	} from '$lib/designer-view';
	import type {
		DealFieldDescriptor,
		DesignerDealSummary
	} from '$lib/types/designer';

	/**
	 * Props — kept explicit so both `/designer` and `/designer/projects` can
	 * render the same view from different deal scopes without coupling to the
	 * page loader's exact shape.
	 */
	export let deals: DesignerDealSummary[];
	export let warning: string;
	export let fieldDescriptors: DealFieldDescriptor[];
	export let designerLabel: string;
	export let heading: string;
	export let emptyMessage = 'No deals found.';
	export let readonly = false;
	export let showHeader = true;
	export let showTabs = true;
	export let showSignOut = true;
	export let tabMode: 'links' | 'inline' = 'links';
	export let initialView: DesignerViewKey = 'active';

	let localDeals: DesignerDealSummary[] = deals;
	$: localDeals = deals;

	let query = '';
	let stageFilter = '';
	let selectedInlineView: DesignerViewKey | null = null;

	$: if (selectedInlineView === null) {
		selectedInlineView = initialView;
	}

	$: activeInlineView = selectedInlineView ?? initialView;
	$: scopedDeals =
		tabMode === 'inline' ? filterDesignerDealsForView(localDeals, activeInlineView) : localDeals;

	$: stages = Array.from(
		new Set(
			scopedDeals
				.map((d) => d.stage)
				.filter((s): s is string => typeof s === 'string' && s.length > 0)
		)
	).sort();

	$: filtered = scopedDeals.filter((deal) => {
		if (stageFilter && deal.stage !== stageFilter) return false;
		if (!query.trim()) return true;
		const needle = query.trim().toLowerCase();
		const hay = [
			deal.name,
			deal.stage,
			deal.contactName,
			deal.accountName,
			deal.address,
			deal.ballInCourt,
			deal.ballInCourtNote
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return hay.includes(needle);
	});

	function onDealUpdated(event: CustomEvent<{ dealId: string; deal: DesignerDealSummary }>) {
		const { dealId, deal: updatedDeal } = event.detail;
		localDeals = localDeals.map((d) => (d.id === dealId ? updatedDeal : d));
	}

	$: pathname = $page.url.pathname;
	$: tabs = DESIGNER_VIEW_TABS;
	$: resolvedEmptyMessage =
		tabMode === 'inline' ? getDesignerEmptyMessageForView(activeInlineView) : emptyMessage;
</script>

<main class="page" class:embedded={!showHeader}>
	{#if showHeader}
		<header class="page-header">
			<div>
				<h1>{heading}</h1>
				<p class="muted">
					Signed in as <strong>{designerLabel}</strong>
					{#if showSignOut}
						· <a href="/api/logout">Sign out</a>
					{/if}
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
	{:else}
		<div class="filters embedded-filters" role="search">
			<label class="sr-only" for="deal-search-embedded">Search deals</label>
			<input
				id="deal-search-embedded"
				type="search"
				placeholder="Search deals, clients, addresses…"
				bind:value={query}
			/>
			<label class="sr-only" for="stage-filter-embedded">Filter by stage</label>
			<select id="stage-filter-embedded" bind:value={stageFilter}>
				<option value="">All stages</option>
				{#each stages as stage}
					<option value={stage}>{stage}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if showTabs}
		<nav class="tabs" aria-label="Designer views">
			{#if tabMode === 'inline'}
				{#each tabs as tab}
					<button
						type="button"
						class="tab"
						class:active={activeInlineView === tab.key}
						aria-pressed={activeInlineView === tab.key}
						on:click={() => {
							selectedInlineView = tab.key;
							query = '';
							stageFilter = '';
						}}
					>
						{tab.label}
					</button>
				{/each}
			{:else}
				{#each tabs as tab}
					<a
						class="tab"
						class:active={pathname === tab.href}
						href={tab.href}
						aria-current={pathname === tab.href ? 'page' : undefined}
					>
						{tab.label}
					</a>
				{/each}
			{/if}
		</nav>
	{/if}

	{#if warning}
		<p class="banner error" role="alert">{warning}</p>
	{/if}

	<section aria-label="Deals" class="deals">
		{#if localDeals.length === 0 && !warning}
			<p class="muted empty">{resolvedEmptyMessage}</p>
		{:else if filtered.length === 0}
			<p class="muted empty">
				{query.trim() || stageFilter ? 'No deals match the current filter.' : resolvedEmptyMessage}
			</p>
		{:else}
			{#each filtered as deal (deal.id)}
				<DealCard {deal} {fieldDescriptors} {readonly} on:dealUpdated={onDealUpdated} />
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

	.page.embedded {
		max-width: none;
		padding: 0;
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

	.embedded-filters {
		justify-content: flex-start;
	}

	.filters input,
	.filters select {
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		font: inherit;
		min-width: 200px;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.tab {
		padding: 0.55rem 0.95rem;
		color: #6b7280;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}

	button.tab {
		background: none;
		border-left: 0;
		border-right: 0;
		border-top: 0;
		cursor: pointer;
		font: inherit;
	}

	.tab:hover {
		color: #111827;
	}

	.tab.active {
		color: #0f172a;
		border-bottom-color: #b45309;
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
