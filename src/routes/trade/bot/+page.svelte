<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';
	import TradeChatPanel from './TradeChatPanel.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	let dealId = $state('');
	let dealLabel = $state('');

	function onDealSelect(event: CustomEvent<{ id: string; label: string }>) {
		dealId = event.detail.id;
		dealLabel = event.detail.label;
	}
</script>

<svelte:head>
	<title>CPR Assistant — CPR Trade Portal</title>
</svelte:head>

<section class="bot-page">
	<header class="bot-header">
		<h1>CPR Assistant</h1>
		<p class="bot-subtitle">
			Ask about your assigned projects — scope, address, access notes, and project documents.
			{#if data.tradePartner?.name}<br /><span class="who">Signed in as {data.tradePartner.name}.</span>{/if}
		</p>
	</header>

	<div class="bot-deal">
		<DealSelector endpoint="/api/trade/bot/deals" on:select={onDealSelect} />
	</div>

	{#if dealId}
		<TradeChatPanel {dealId} {dealLabel} />
	{:else}
		<div class="bot-empty">Select a project above to start.</div>
	{/if}
</section>

<style>
	.bot-page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.bot-header h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}
	.bot-subtitle {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.95rem;
	}
	.who {
		color: #9ca3af;
		font-size: 0.85rem;
	}
	.bot-deal {
		margin-bottom: 1rem;
	}
	.bot-empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
	}
</style>
