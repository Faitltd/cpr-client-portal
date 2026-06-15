<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	type Shift = {
		id: string;
		person: string | null;
		title: string | null;
		location: string | null;
		starts_at: string | null;
		ends_at: string | null;
	};
	type Day = { date: string; weekday: string; md: string; isToday: boolean };

	export let weekDays: Day[] = [];
	export let people: string[] = [];
	export let allPeople: string[] = [];
	export let shifts: Shift[] = [];
	export let weekStart = '';
	export let weekLabel = '';
	export let prevWeek = '';
	export let nextWeek = '';
	export let thisWeek = '';
	export let personFilter = '';
	/** Admin-only: show the "Sync now" button (hits the admin sync endpoint). */
	export let showSync = false;

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
		const m = new Map<string, Map<string, Shift[]>>();
		for (const s of shifts ?? []) {
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
		const map = new Map<string, { label: string; items: Shift[] }>();
		for (const s of shifts ?? []) {
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
		goto(buildUrl(weekStart, (e.target as HTMLSelectElement).value));
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

<div class="toolbar">
	<select class="filter" on:change={onPersonChange} value={personFilter}>
		<option value="">Everyone</option>
		{#each allPeople as p}<option value={p}>{p}</option>{/each}
	</select>
	<div class="weeknav">
		<a class="nav-btn" href={buildUrl(prevWeek, personFilter)} aria-label="Previous week">‹</a>
		<a class="nav-week" href={buildUrl(thisWeek, personFilter)}>{weekLabel}</a>
		<a class="nav-btn" href={buildUrl(nextWeek, personFilter)} aria-label="Next week">›</a>
	</div>
	{#if showSync}
		<button class="sync" type="button" on:click={syncNow} disabled={syncing}>
			{syncing ? 'Syncing…' : 'Sync now'}
		</button>
	{/if}
</div>

{#if message}<p class="message">{message}</p>{/if}

<details class="panel">
	<summary>Calendar (week grid)</summary>
	<div class="panel-body">
		{#if people.length === 0}
			<div class="empty">No shifts to show.</div>
		{:else}
			<div class="grid-wrap">
				<div class="grid">
					<div class="corner"></div>
					{#each weekDays as day}
						<div class="day-head" class:today={day.isToday}>
							<span class="dow">{day.weekday}</span>
							<span class="dmd">{day.md}</span>
						</div>
					{/each}

					{#each people as person}
						<div class="person-cell">
							<span class="avatar" style="background:{colorFor(person)}">{initials(person)}</span>
							<span class="pname">{person}</span>
						</div>
						{#each weekDays as day}
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
		{#if (shifts ?? []).length === 0}
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

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
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

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #f9fafb;
	}
</style>
