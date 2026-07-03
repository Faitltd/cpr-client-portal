<script lang="ts">
	import { onDestroy } from 'svelte';
	import Gallery from '$lib/beforeafter/Gallery.svelte';
	import { savePair } from '$lib/beforeafter/db';

	let beforeBlob: Blob | null = null;
	let beforeUrl = '';
	let beforeEl: HTMLInputElement;
	let afterEl: HTMLInputElement;

	function onBefore(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) {
			beforeBlob = file;
			if (beforeUrl) URL.revokeObjectURL(beforeUrl);
			beforeUrl = URL.createObjectURL(file);
		}
		input.value = '';
	}

	async function onAfter(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		try {
			if (file && beforeBlob) {
				await savePair(beforeBlob, file);
				reset();
			}
		} catch (err) {
			alert('Save error: ' + (err instanceof Error ? err.message : String(err)));
		}
		input.value = '';
	}

	function reset() {
		if (beforeUrl) URL.revokeObjectURL(beforeUrl);
		beforeUrl = '';
		beforeBlob = null;
	}

	onDestroy(() => {
		if (beforeUrl) URL.revokeObjectURL(beforeUrl);
	});
</script>

<div class="ba-app">
	<a class="back" href="/trade/dashboard">← Back to Dashboard</a>

	<input type="file" accept="image/*" bind:this={beforeEl} on:change={onBefore} style="display:none" />
	<input type="file" accept="image/*" bind:this={afterEl} on:change={onAfter} style="display:none" />

	{#if !beforeBlob}
		<h1>Before / After</h1>
		<button on:click={() => beforeEl.click()}>Select before photo</button>
		<Gallery />
	{:else}
		<p class="hint">Now select the AFTER photo</p>
		{#if beforeUrl}
			<img class="preview" src={beforeUrl} alt="Selected before" />
		{/if}
		<button on:click={() => afterEl.click()}>Select after photo</button>
		<button class="secondary" on:click={reset}>Cancel</button>
	{/if}
</div>

<style>
	/* Scoped port of the standalone app's app.css. The `.ba-app` wrapper carries
	   the Svelte scope hash, so `:global(button)` reaches the child components'
	   buttons without leaking button/body rules into the rest of the portal. */
	.ba-app {
		margin: 0 auto;
		padding: 1rem;
		max-width: 640px;
		font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
		color: #111;
	}
	.ba-app :global(button) {
		display: block;
		width: 100%;
		padding: 1.25rem 1.25rem;
		margin: 0.6rem 0;
		font-size: 1.3rem;
		font-weight: 600;
		line-height: 1.2;
		color: #fff;
		background: #111;
		border: none;
		border-radius: 14px;
		cursor: pointer;
	}
	.ba-app :global(button:active) {
		transform: scale(0.99);
		opacity: 0.85;
	}
	.ba-app :global(button.secondary) {
		background: #444;
	}
	.ba-app :global(button.danger) {
		background: #c0392b;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
		color: #0066cc;
		text-decoration: none;
		font-weight: 600;
	}
	.back:hover {
		text-decoration: underline;
	}
	h1 {
		font-size: 1.7rem;
		margin: 0.5rem 0 1rem;
	}
	.hint {
		font-size: 1.15rem;
		margin: 0 0 0.5rem;
	}
	.preview {
		width: 100%;
		border-radius: 12px;
		display: block;
	}
</style>
