<script lang="ts">
	import ScheduleView from '$lib/components/ScheduleView.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
	export let form: { message?: string } | undefined;
</script>

<svelte:head>
	<title>Schedule — CPR Admin</title>
</svelte:head>

<section class="page">
	<h1>Schedule</h1>

	<ScheduleView
		weekDays={data.weekDays}
		people={data.people}
		allPeople={data.allPeople}
		shifts={data.shifts}
		weekStart={data.weekStart}
		weekLabel={data.weekLabel}
		prevWeek={data.prevWeek}
		nextWeek={data.nextWeek}
		thisWeek={data.thisWeek}
		personFilter={data.personFilter}
		showSync
	/>

	{#if form?.message}<p class="message">{form.message}</p>{/if}

	<section class="feeds">
		<h2 class="section-label">Feeds</h2>
		<div class="feed-list">
			{#each data.feeds ?? [] as feed (feed.id)}
				<div class="feed-row">
					<div class="feed-info">
						<span class="feed-label">{feed.label || 'Unlabeled'}</span>
						<span class="feed-status">
							{#if feed.last_sync_error}
								<span class="err">error: {feed.last_sync_error}</span>
							{:else}
								{feed.last_shift_count ?? 0} shifts
							{/if}
						</span>
					</div>
					<form method="POST" action="?/deleteFeed">
						<input type="hidden" name="id" value={feed.id} />
						<button type="submit" class="del" title="Remove feed">Remove</button>
					</form>
				</div>
			{/each}
			{#if (data.feeds ?? []).length === 0}
				<p class="muted">No feeds yet. Add a person's Connecteam calendar-sync link below.</p>
			{/if}
		</div>

		<form method="POST" action="?/addFeed" class="add-feed">
			<input name="label" placeholder="Name (e.g. Jeff Smither)" class="in-label" />
			<input name="ics_url" placeholder="Connecteam calendar-sync URL (https://…)" class="in-url" />
			<button type="submit">Add</button>
		</form>
	</section>
</section>

<style>
	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.message {
		background: #eef2f7;
		border-radius: 8px;
		padding: 0.55rem 0.8rem;
		color: #1f2937;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.feeds {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 1rem 1.1rem;
	}

	.section-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #6b7280;
		font-weight: 700;
		margin: 0 0 0.75rem;
	}

	.feed-list {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}

	.feed-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #f1f5f9;
		border-radius: 8px;
		background: #f9fafb;
	}

	.feed-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.feed-label {
		font-weight: 600;
		color: #0f172a;
	}

	.feed-status {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.feed-status .err {
		color: #b91c1c;
	}

	.del {
		background: #fff;
		border: 1px solid #e5e7eb;
		color: #b91c1c;
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.del:hover {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.add-feed {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.add-feed input {
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		font: inherit;
	}

	.in-label {
		width: 170px;
	}

	.in-url {
		flex: 1;
		min-width: 240px;
	}

	.add-feed button {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 8px;
		background: #111827;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	.muted {
		color: #6b7280;
		font-size: 0.9rem;
		margin: 0;
	}
</style>
