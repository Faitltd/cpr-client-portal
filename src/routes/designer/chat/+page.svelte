<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';
	import ChatPanel from '../../admin/bot/ChatPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let dealId = $state('');
	let dealLabel = $state('');

	function onDealSelect(event: CustomEvent<{ id: string; label: string }>) {
		dealId = event.detail.id;
		dealLabel = event.detail.label;
	}
</script>

<svelte:head>
	<title>CPR Bot · Designer · CPR Portal</title>
</svelte:head>

<section class="chat-page">
	<p class="subtitle">
		Pick a Deal and ask anything about its emails, Cliq messages, invoices, WorkDrive
		files, or transcripts.
	</p>

	<div class="deal-pick">
		<DealSelector endpoint="/api/admin/bot/deals" on:select={onDealSelect} />
	</div>

	{#if dealId}
		<ChatPanel {dealId} {dealLabel} mode="chat-only" />
	{:else}
		<div class="empty">Select a Deal to start a conversation.</div>
	{/if}
</section>

<style>
	.chat-page {
		padding: 0;
	}

	.subtitle {
		color: #6b7280;
		margin: 0 0 1rem;
	}

	.deal-pick {
		margin-bottom: 1rem;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
	}
</style>
