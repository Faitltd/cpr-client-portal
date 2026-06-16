<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	const TZ = 'America/Denver';
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '';
</script>

<svelte:head>
	<title>Field Update · Designer · CPR Portal</title>
</svelte:head>

{#if data.isAdmin}
	<h1 class="title">Field Updates</h1>
	{#if data.warning}<p class="warn">{data.warning}</p>{/if}
	{#if (data.updates ?? []).length === 0}
		<div class="empty">No field updates submitted yet.</div>
	{:else}
		<div class="list">
			{#each data.updates as u (u.id)}
				<div class="row">
					<div class="rhead">
						{#if u.type}<span class="type">{u.type}</span>{/if}
						{#if u.dealName}<span class="deal">{u.dealName}</span>{/if}
						<span class="when">{when(u.created)}</span>
					</div>
					{#if u.note}<p class="note">{u.note}</p>{/if}
				</div>
			{/each}
		</div>
	{/if}
{:else}
	<iframe title="Field Update" src="/trade/field-update?embed=1" class="embed-frame"></iframe>
{/if}

<style>
	.title {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.warn {
		border: 1px solid #fde68a;
		background: #fffbeb;
		color: #92400e;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		margin-bottom: 1rem;
	}

	.list {
		display: grid;
		gap: 0.6rem;
	}

	.row {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 0.7rem 0.85rem;
	}

	.rhead {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.25rem;
	}

	.type {
		font-weight: 700;
		color: #0f172a;
	}

	.deal {
		color: #334155;
		font-weight: 600;
	}

	.when {
		margin-left: auto;
		color: #6b7280;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.note {
		margin: 0;
		color: #374151;
		white-space: pre-wrap;
		line-height: 1.45;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
	}

	.embed-frame {
		width: 100%;
		border: 0;
		display: block;
		min-height: 800px;
		height: calc(100vh - 200px);
	}
</style>
