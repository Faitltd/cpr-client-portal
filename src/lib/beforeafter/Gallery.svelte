<script lang="ts">
	import { onMount } from 'svelte';
	import { getAllPairs, deletePair } from '$lib/beforeafter/db';
	import { exportGif } from '$lib/beforeafter/exportGif';
	let pairs: any[] = [];
	onMount(load);
	async function load() {
		pairs = await getAllPairs();
	}
	function url(blob: Blob) {
		return URL.createObjectURL(blob);
	}
	async function remove(id: number) {
		await deletePair(id);
		await load();
	}
</script>

{#each pairs as p (p.id)}
	<div class="pair">
		<div class="thumbs">
			<img src={url(p.before)} alt="before" />
			<img src={url(p.after)} alt="after" />
		</div>
		<button on:click={() => exportGif(p.before, p.after, 'dissolve')}>GIF Dissolve</button>
		<button on:click={() => exportGif(p.before, p.after, 'slide')}>GIF Slide</button>
		<button class="danger" on:click={() => remove(p.id)}>Delete</button>
	</div>
{/each}

<style>
	.pair {
		margin: 1.5rem 0;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid #eee;
	}
	.thumbs {
		display: flex;
		gap: 2%;
		margin-bottom: 0.5rem;
	}
	.thumbs img {
		width: 49%;
		border-radius: 8px;
	}
</style>
