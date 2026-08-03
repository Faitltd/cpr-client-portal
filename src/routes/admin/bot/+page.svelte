<script lang="ts">
	import MasterChatPanel from './MasterChatPanel.svelte';
</script>

<svelte:head>
	<title>CPR Assistant — CPR Admin</title>
</svelte:head>

<section class="bot-page">
	<header class="bot-header">
		<h1>CPR Assistant</h1>
		<p class="bot-subtitle">
			Read-only assistant across every deal — projects, schedule, invoices, documents, contracts,
			email, and Cliq. Ask about one project or all of them at once.
		</p>
	</header>

	<MasterChatPanel />
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
</style>
