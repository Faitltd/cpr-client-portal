<script lang="ts">
	import DealSelector from '$lib/components/DealSelector.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import MasterChatPanel from './MasterChatPanel.svelte';
	import CommsChatPanel from './CommsChatPanel.svelte';

	let tab = $state<'deal' | 'master' | 'comms'>('deal');
	let dealId = $state('');
	let dealLabel = $state('');

	function onDealSelect(event: CustomEvent<{ id: string; label: string }>) {
		dealId = event.detail.id;
		dealLabel = event.detail.label;
	}
</script>

<svelte:head>
	<title>CPR Assistant — CPR Admin</title>
</svelte:head>

<section class="bot-page">
	<header class="bot-header">
		<h1>CPR Assistant</h1>
		<p class="bot-subtitle">
			Read-only assistant. The Deal Assistant answers about one project; the Master Assistant
			answers across every deal at once; the Comms Assistant reads only email and Cliq.
		</p>
	</header>

	<nav class="bot-tabs">
		<button type="button" class="bot-tab" class:active={tab === 'deal'} onclick={() => (tab = 'deal')}>
			Deal Assistant
		</button>
		<button
			type="button"
			class="bot-tab"
			class:active={tab === 'master'}
			onclick={() => (tab = 'master')}
		>
			Master Assistant
		</button>
		<button
			type="button"
			class="bot-tab"
			class:active={tab === 'comms'}
			onclick={() => (tab = 'comms')}
		>
			Comms Assistant
		</button>
	</nav>

	{#if tab === 'deal'}
		<div class="bot-deal">
			<DealSelector endpoint="/api/admin/bot/deals" on:select={onDealSelect} />
		</div>

		{#if dealId}
			<ChatPanel {dealId} {dealLabel} />
		{:else}
			<div class="bot-empty">Select a Deal to start a conversation.</div>
		{/if}
	{:else if tab === 'master'}
		<MasterChatPanel />
	{:else}
		<CommsChatPanel />
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

	.bot-tabs {
		display: inline-flex;
		gap: 0.4rem;
		background: #eef2f7;
		padding: 0.35rem;
		border-radius: 0.7rem;
		margin-bottom: 1.25rem;
	}

	.bot-tab {
		padding: 0.5rem 1rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		background: transparent;
		color: #334155;
		font: inherit;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.bot-tab:hover {
		background: #dbe3ee;
		color: #0f172a;
	}

	.bot-tab.active {
		background: #111827;
		color: #fff;
		border-color: #111827;
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
