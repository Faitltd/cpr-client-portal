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
	<title>Project Chat · Designer · CPR Portal</title>
</svelte:head>

<section class="chat-page">
	<header class="chat-header">
		<div>
			<h1>Project Chat</h1>
			<p class="muted">
				Signed in as <strong>{data.designer?.name || data.designer?.email}</strong>
				· <a href="/api/logout">Sign out</a>
			</p>
		</div>
		<nav class="tabs">
			<a class="tab" href="/designer">Active Deals</a>
			<a class="tab" href="/designer/projects">Project Created</a>
			<a class="tab" href="/designer/on-hold">On Hold</a>
			<a class="tab active" href="/designer/chat">CPR Bot</a>
		</nav>
	</header>

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
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	.chat-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.chat-header h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.muted {
		color: #6b7280;
		font-size: 0.9rem;
		margin: 0;
	}

	.tabs {
		display: inline-flex;
		gap: 0.25rem;
		background: #f3f4f6;
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.tab {
		padding: 0.4rem 0.85rem;
		border-radius: 0.4rem;
		font-size: 0.9rem;
		color: #374151;
		text-decoration: none;
	}

	.tab:hover {
		background: #e5e7eb;
	}

	.tab.active {
		background: #111827;
		color: #ffffff;
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
