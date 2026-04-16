<script lang="ts">
	import DesignerDealsView from '$lib/components/designer/DesignerDealsView.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
	$: designerLabel = data.designer?.name ?? data.designer?.email ?? 'Designer';
</script>

<svelte:head>
	<title>On Hold · Designer · CPR Portal</title>
</svelte:head>

<DesignerDealsView
	deals={data.deals}
	warning={data.warning}
	fieldDescriptors={data.fieldDescriptors}
	{designerLabel}
	heading="On Hold"
	emptyMessage="No deals currently On Hold."
/>
