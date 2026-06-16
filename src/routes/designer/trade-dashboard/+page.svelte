<script lang="ts">
	import DesignerDealsView from '$lib/components/designer/DesignerDealsView.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>Field Dashboard · Designer · CPR Portal</title>
</svelte:head>

{#if data.isAdmin}
	<h1 class="title">Field Projects</h1>
	<DesignerDealsView
		deals={data.deals}
		warning={data.warning ?? ''}
		fieldDescriptors={data.fieldDescriptors}
		designerLabel="All field projects"
		heading="Field Projects"
		emptyMessage="No active field projects right now."
		readonly={true}
		showHeader={false}
		showTabs={false}
	/>
{:else}
	<iframe title="Field Dashboard" src="/trade/dashboard?embed=1" class="embed-frame"></iframe>
{/if}

<style>
	.title {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.embed-frame {
		width: 100%;
		border: 0;
		display: block;
		min-height: 800px;
		height: calc(100vh - 200px);
	}
</style>
