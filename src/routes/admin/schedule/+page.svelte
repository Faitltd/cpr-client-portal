<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	export let data: PageData;
	export let form: { message?: string } | undefined;

	const TZ = 'America/Denver';
	let syncing = false;
	let message = '';

	const denverDate = (iso: string | null) =>
		iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '';

	const t = (iso: string | null) =>
		iso
			? new Date(iso)
					.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
					.replace(/\s?AM/, 'a')
					.replace(/\s?PM/, 'p')
			: '';

	const initials = (name: string) =>
		name
			.split(/[\s—–-]+/)
			.filter(Boolean)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

	const PALETTE = [
		'#e8b9cd',
		'#c7b8e6',
		'#bfe0cd',
		'#f1d6a0',
		'#aecbf0',
		'#e6b3ad',
		'#cbb79e',
		'#b9d8ea',
		'#d9c2e8',
		'#efc0ae'
	];
	const colorFor = (key: string) => {
		let h = 0;
		for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
		return PALETTE[h % PALETTE.length];
	};

	$: byPersonDay = (() => {
		const m = new Map<string, Map<string, typeof data.shifts>>();
		for (const s of data.shifts ?? []) {
			const p = s.person ?? 'Unassigned';
			const d = denverDate(s.starts_at);
			if (!m.has(p)) m.set(p, new Map());
			const dm = m.get(p)!;
			if (!dm.has(d)) dm.set(d, []);
			dm.get(d)!.push(s);
		}
		return m;
	})();
	const shiftsFor = (person: string, date: string) => byPersonDay.get(person)?.get(date) ?? [];

	$: listGroups = (() => {
		const map = new Map<string, { label: string; items: typeof data.shifts }>();
		for (const s of data.shifts ?? []) {
			const key = denverDate(s.starts_at);
			if (!map.has(key)) {
				const label = s.starts_at
					? new Date(s.starts_at).toLocaleDateString('en-US', {
							timeZone: TZ,
							weekday: 'long',
							month: 'short',
							day: 'numeric'
						})
					: 'Undated';
				map.set(key, { label, items: [] });
			}
			map.get(key)!.items.push(s);
		}
		for (const g of map.values()) {
			g.items.sort(
				(a, b) =>
					(a.starts_at ?? '').localeCompare(b.starts_at ?? '') ||
					(a.person ?? '').localeCompare(b.person ?? '')
			);
		}
		return Array.from(map.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([, v]) => v);
	})();

	function buildUrl(week: string, person: string) {
		const p = new URLSearchParams();
		p.set('week', week);
		if (person) p.set('person', person);
		return '?' + p.toString();
	}

	function onPersonChange(e: Event) {
		goto(buildUrl(data.weekStart, (e.target as HTMLSelectElement).value));
	}

	async function syncNow() {
		syncing = true;
		message = '';
		try {
			const res = await fetch('/api/admin/schedule/sync', { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) message = payload?.message || 'Sync failed.';
			else {
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
		<h1>Schedule</h1>
		<div class="toolbar">
			<select class="filter" on:change={onPersonChange} value={data.personFilter}>
				<option value="">Everyone</option>
				{#each data.allPeople as p}<option value={p}>{p}</option>{/each}
			</select>
			<div class="weeknav">
				<a class="nav-btn" href={buildUrl(data.prevWeek, data.personFilter)} aria-label="Previous week"
					>‹</a
				>
				<a class="nav-week" href={buildUrl(data.thisWeek, data.personFilter)}>{data.weekLabel}</a>
				<a class="nav-btn" href={buildUrl(data.nextWeek, data.personFilter)} aria-label="Next week"
					>›</a
				>
			</div>
			<button class="sync" type="button" on:click={syncNow} disabled={syncing}>
				{syncing ? 'Syncing…' : 'Sync now'}
			</button>
		</div>
	</header>

	{#if message}<p class="message">{message}</p>{/if}
	{#if form?.message}<p class="message">{form.message}</p>{/if}

	<details class="panel">
		<summary>Calendar (week grid)</summary>
		<div class="panel-body">
			{#if data.people.length === 0}
				<div class="empty">No people yet. Add a feed below, then click <strong>Sync now</strong>.</div>
			{:else}
				<div class="grid-wrap">
					<div class="grid">
						<div class="corner"></div>
						{#each data.weekDays as day}
							<div class="day-head" class:today={day.isToday}>
								<span class="dow">{day.weekday}</span>
								<span class="dmd">{day.md}</span>
							</div>
						{/each}

						{#each data.people as person}
							<div class="person-cell">
								<span class="avatar" style="background:{colorFor(person)}">{initials(person)}</span>
								<span class="pname">{person}</span>
							</div>
							{#each data.weekDays as day}
								<div class="cell" class:today={day.isToday}>
									{#each shiftsFor(person, day.date) as s (s.id)}
										<div class="block" style="background:{colorFor(s.title ?? '')}">
											<span class="bt">{t(s.starts_at)} - {t(s.ends_at)}</span>
											<span class="bj">{s.title ?? 'Untitled'}</span>
										</div>
									{/each}
								</div>
							{/each}
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</details>

	<details class="panel" open>
		<summary>List</summary>
		<div class="panel-body">
			{#if (data.shifts ?? []).length === 0}
				<div class="empty">No shifts this week.</div>
			{:else}
				{#each listGroups as group}
					<div class="day-group">
						<h3 class="day-label">{group.label}</h3>
						<div class="lrows">
							{#each group.items as s (s.id)}
								<div class="lrow">
									<div class="lmain">
										<span class="lperson">{s.person ?? 'Unassigned'}</span>
										<span class="ljob">{s.title ?? 'Untitled'}</span>
										<span class="ltime">{t(s.starts_at)} - {t(s.ends_at)}</span>
									</div>
									{#if s.location}<div class="lloc">{s.location}</div>{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</details>

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

	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
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

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.filter {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		font: inherit;
		background: #fff;
	}

	.weeknav {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 999px;
		padding: 0.15rem;
		background: #fff;
	}

	.nav-btn {
		text-decoration: none;
		color: #374151;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
	}

	.nav-btn:hover {
		background: #f3f4f6;
	}

	.nav-week {
		text-decoration: none;
		color: #111827;
		font-weight: 600;
		font-size: 0.9rem;
		padding: 0.3rem 0.6rem;
	}

	.sync {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 8px;
		background: #111827;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	.sync:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.message {
		background: #eef2f7;
		border-radius: 8px;
		padding: 0.55rem 0.8rem;
		color: #1f2937;
		font-size: 0.9rem;
	}

	.panel {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		margin-bottom: 1rem;
		overflow: hidden;
	}

	.panel > summary {
		cursor: pointer;
		padding: 0.75rem 1rem;
		font-weight: 700;
		color: #0f172a;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		user-select: none;
	}

	.panel > summary::-webkit-details-marker {
		display: none;
	}

	.panel > summary::before {
		content: '▸';
		color: #9ca3af;
		font-size: 0.85rem;
	}

	.panel[open] > summary::before {
		content: '▾';
	}

	.panel-body {
		padding: 0 1rem 1rem;
	}

	.grid-wrap {
		overflow-x: auto;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	/* ── List view ── */
	.day-group {
		margin-bottom: 1.25rem;
	}

	.day-group:last-child {
		margin-bottom: 0;
	}

	.day-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.5rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.lrows {
		display: grid;
		gap: 0.5rem;
	}

	.lrow {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #fff;
		padding: 0.6rem 0.75rem;
	}

	.lmain {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		flex-wrap: wrap;
	}

	.lperson {
		font-weight: 700;
		color: #0f172a;
	}

	.ljob {
		color: #334155;
	}

	.ltime {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: #2563eb;
		font-weight: 600;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.lloc {
		color: #6b7280;
		font-size: 0.85rem;
		margin-top: 0.2rem;
	}

	.grid {
		display: grid;
		grid-template-columns: 170px repeat(7, minmax(140px, 1fr));
		min-width: 920px;
	}

	.corner {
		position: sticky;
		left: 0;
		z-index: 3;
		background: #f8fafc;
		border-bottom: 1px solid #e5e7eb;
	}

	.day-head {
		background: #f8fafc;
		border-bottom: 1px solid #e5e7eb;
		border-left: 1px solid #eef2f7;
		padding: 0.6rem 0.5rem;
		text-align: center;
		font-size: 0.85rem;
		color: #374151;
	}

	.day-head .dow {
		font-weight: 700;
		color: #0f172a;
	}

	.day-head .dmd {
		color: #6b7280;
		margin-left: 0.25rem;
	}

	.day-head.today {
		background: #e0edff;
	}

	.person-cell {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #fff;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem;
		border-top: 1px solid #f1f5f9;
	}

	.avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
		color: #1f2937;
		flex-shrink: 0;
	}

	.pname {
		font-weight: 600;
		color: #0f172a;
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cell {
		border-top: 1px solid #f1f5f9;
		border-left: 1px solid #f5f7fa;
		padding: 0.3rem;
		min-height: 62px;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.cell.today {
		background: #f5f9ff;
	}

	.block {
		border-radius: 6px;
		padding: 0.35rem 0.45rem;
		font-size: 0.76rem;
		line-height: 1.25;
		color: #1f2937;
	}

	.block .bt {
		display: block;
		font-weight: 700;
	}

	.block .bj {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Feeds manager ── */
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

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
		margin-bottom: 1.5rem;
	}
</style>
