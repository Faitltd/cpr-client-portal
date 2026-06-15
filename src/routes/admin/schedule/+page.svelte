<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	export let data: PageData;
	export let form: { message?: string } | undefined;

	const TZ = 'America/Denver';
	let syncing = false;
	let message = '';

	const fmtSynced = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : 'never';

	const dayKey = (iso: string | null) =>
		iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ }) : 'Undated';

	const dayLabel = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString('en-US', {
					timeZone: TZ,
					weekday: 'long',
					month: 'short',
					day: 'numeric'
				})
			: 'Undated';

	const timeLabel = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleTimeString('en-US', {
					timeZone: TZ,
					hour: 'numeric',
					minute: '2-digit'
				})
			: '';

	$: groups = (() => {
		const map = new Map<string, { label: string; shifts: typeof data.shifts }>();
		for (const s of data.shifts ?? []) {
			const key = dayKey(s.starts_at);
			if (!map.has(key)) map.set(key, { label: dayLabel(s.starts_at), shifts: [] });
			map.get(key)!.shifts.push(s);
		}
		return Array.from(map.values());
	})();

	async function syncNow() {
		syncing = true;
		message = '';
		try {
			const res = await fetch('/api/admin/schedule/sync', { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				message = payload?.message || 'Sync failed.';
			} else {
				message = `Synced ${payload.total} shifts from ${payload.feeds} feed(s).`;
				if (payload.errors?.length) message += ` Errors: ${payload.errors.join('; ')}`;
				await invalidateAll();
			}
		} catch (e) {
			message = e instanceof Error ? e.message : 'Sync failed.';
		} finally {
			syncing = false;
		}
	}
</script>

<svelte:head>
	<title>Schedule — CPR Admin</title>
</svelte:head>

<section class="page">
	<header class="head">
		<div>
			<h1>Schedule</h1>
			<p class="muted">Connecteam shifts synced into the portal.</p>
		</div>
		<button type="button" onclick={syncNow} disabled={syncing}>
			{syncing ? 'Syncing…' : 'Sync now'}
		</button>
	</header>

	{#if message}<p class="message">{message}</p>{/if}
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
								{feed.last_shift_count ?? 0} shifts · synced {fmtSynced(feed.last_synced_at)}
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
			<input name="label" placeholder="Name (e.g. Jeff)" class="in-label" />
			<input name="ics_url" placeholder="Connecteam calendar-sync URL (https://…)" class="in-url" />
			<button type="submit">Add</button>
		</form>
	</section>

	{#if groups.length === 0}
		<div class="empty">
			No upcoming shifts yet. Click <strong>Sync now</strong> to pull the latest from Connecteam.
		</div>
	{:else}
		{#each groups as group}
			<div class="day">
				<h2 class="day-label">{group.label}</h2>
				<div class="shifts">
					{#each group.shifts as shift (shift.id)}
						<div class="shift">
							<div class="shift-main">
								<span class="time">{timeLabel(shift.starts_at)}–{timeLabel(shift.ends_at)}</span>
								<span class="title">{shift.title ?? 'Untitled'}</span>
							</div>
							{#if shift.location}<div class="loc">{shift.location}</div>{/if}
							{#if shift.crew?.length}
								<div class="crew">
									{#each shift.crew as person}<span class="chip">{person}</span>{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</section>

<style>
	.page {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.muted {
		margin: 0.25rem 0 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	button {
		padding: 0.55rem 1.1rem;
		border: none;
		border-radius: 0.5rem;
		background: #111827;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.message {
		background: #eef2f7;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		color: #1f2937;
		font-size: 0.9rem;
	}

	.feeds {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 1rem 1.1rem;
		margin-bottom: 1.5rem;
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
		width: 160px;
	}

	.in-url {
		flex: 1;
		min-width: 240px;
	}

	.add-feed button {
		padding: 0.5rem 1rem;
	}

	.day {
		margin-bottom: 1.5rem;
	}

	.day-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.6rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.shifts {
		display: grid;
		gap: 0.6rem;
	}

	.shift {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 0.75rem 0.9rem;
	}

	.shift-main {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		flex-wrap: wrap;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: #2563eb;
		font-weight: 600;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.title {
		font-weight: 600;
		color: #0f172a;
	}

	.loc {
		color: #6b7280;
		font-size: 0.85rem;
		margin-top: 0.2rem;
	}

	.crew {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	.chip {
		background: #eef2f7;
		color: #1f2937;
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
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
