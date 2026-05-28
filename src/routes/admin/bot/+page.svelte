<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';
	import ChatPanel from './ChatPanel.svelte';

	let dealId = $state('');
	let dealLabel = $state('');

	function onDealSelect(event: CustomEvent<{ id: string; label: string }>) {
		dealId = event.detail.id;
		dealLabel = event.detail.label;
	}
</script>

<svelte:head>
	<title>Bot — CPR Admin</title>
</svelte:head>

<section class="bot-page">
	<header class="bot-header">
		<h1>CRM Bot</h1>
		<p class="bot-subtitle">
			Read-only assistant. Pick a Deal, then ask about address, contact, stage, or anything in
			the live Zoho record.
		</p>
	</header>

	<div class="bot-deal">
		<DealSelector endpoint="/api/admin/bot/deals" on:select={onDealSelect} />
	</div>

	{#if dealId}
		<ChatPanel {dealId} {dealLabel} />
	{:else}
		<div class="bot-empty">Select a Deal to start a conversation.</div>
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
