<script lang="ts">
	import { onMount } from 'svelte';

	export let total = 0;
	export let completed = 0;
	/** Optional per-phase rollup: [{ name, total, completed }] */
	export let phases: { name: string; total: number; completed: number }[] = [];
	export let loading = false;

	const RED = '#E11B22';
	const GREEN = '#16a34a';
	const AMBER = '#f59e0b';

	$: pct = total > 0 ? Math.round((completed / total) * 100) : 0;
	$: inProgress = Math.max(total - completed, 0);

	// Donut geometry
	const R = 52;
	const C = 2 * Math.PI * R;
	$: dashOffset = C * (1 - pct / 100);

	// Count-up animation for the centre number.
	let shownPct = 0;
	let shownCompleted = 0;
	function animateTo(targetPct: number, targetDone: number) {
		const startPct = shownPct;
		const startDone = shownCompleted;
		const t0 = performance.now();
		const dur = 900;
		const step = (now: number) => {
			const k = Math.min((now - t0) / dur, 1);
			const ease = 1 - Math.pow(1 - k, 3);
			shownPct = Math.round(startPct + (targetPct - startPct) * ease);
			shownCompleted = Math.round(startDone + (targetDone - startDone) * ease);
			if (k < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}
	let mounted = false;
	onMount(() => {
		mounted = true;
		animateTo(pct, completed);
	});
	$: if (mounted) animateTo(pct, completed);
</script>

<section class="progress-card">
	<div class="pc-head">
		<span class="pc-accent" aria-hidden="true"></span>
		<h3>Project progress</h3>
	</div>

	{#if loading}
		<div class="pc-skeleton">
			<div class="sk-ring"></div>
			<div class="sk-lines">
				<div class="sk-line"></div>
				<div class="sk-line short"></div>
				<div class="sk-line"></div>
			</div>
		</div>
	{:else if total === 0}
		<p class="pc-empty">Your task plan will appear here once your project manager adds it.</p>
	{:else}
		<div class="pc-body">
			<div class="ring-wrap">
				<svg viewBox="0 0 120 120" class="ring" role="img" aria-label={`${pct}% of tasks complete`}>
					<circle cx="60" cy="60" r={R} fill="none" stroke="#e5e7eb" stroke-width="12" />
					<circle
						cx="60"
						cy="60"
						r={R}
						fill="none"
						stroke={GREEN}
						stroke-width="12"
						stroke-linecap="round"
						stroke-dasharray={C}
						stroke-dashoffset={dashOffset}
						transform="rotate(-90 60 60)"
						class="ring-fg"
					/>
				</svg>
				<div class="ring-center">
					<span class="ring-pct">{shownPct}%</span>
					<span class="ring-sub">complete</span>
				</div>
			</div>

			<div class="kpis">
				<div class="kpi">
					<span class="kpi-num" style="color:{GREEN}">{shownCompleted}</span>
					<span class="kpi-label">Tasks done</span>
				</div>
				<div class="kpi">
					<span class="kpi-num" style="color:{AMBER}">{inProgress}</span>
					<span class="kpi-label">Remaining</span>
				</div>
				<div class="kpi">
					<span class="kpi-num" style="color:{RED}">{total}</span>
					<span class="kpi-label">Total tasks</span>
				</div>
			</div>
		</div>

		{#if phases.length > 0}
			<div class="phases">
				{#each phases as ph (ph.name)}
					{@const p = ph.total > 0 ? Math.round((ph.completed / ph.total) * 100) : 0}
					<div class="phase-row">
						<span class="phase-name" title={ph.name}>{ph.name}</span>
						<span class="phase-bar"><span class="phase-fill" style="width:{p}%"></span></span>
						<span class="phase-count">{ph.completed}/{ph.total}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.progress-card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 14px;
		padding: 1.1rem 1.25rem 1.25rem;
		margin: 1rem 0;
	}

	.pc-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}

	.pc-accent {
		width: 4px;
		height: 18px;
		border-radius: 2px;
		background: #e11b22;
		display: inline-block;
	}

	.pc-head h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #111827;
	}

	.pc-body {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.ring-wrap {
		position: relative;
		width: 140px;
		height: 140px;
		flex-shrink: 0;
	}

	.ring {
		width: 140px;
		height: 140px;
		display: block;
	}

	.ring-fg {
		transition: stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ring-center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.ring-pct {
		font-size: 1.9rem;
		font-weight: 800;
		color: #111827;
		line-height: 1;
	}

	.ring-sub {
		font-size: 0.78rem;
		color: #6b7280;
		margin-top: 0.15rem;
	}

	.kpis {
		display: flex;
		gap: 0.75rem;
		flex: 1;
		min-width: 220px;
	}

	.kpi {
		flex: 1;
		background: #f9fafb;
		border: 1px solid #f1f5f9;
		border-radius: 12px;
		padding: 0.85rem 0.5rem;
		text-align: center;
	}

	.kpi-num {
		display: block;
		font-size: 1.6rem;
		font-weight: 800;
		line-height: 1.1;
	}

	.kpi-label {
		display: block;
		font-size: 0.78rem;
		color: #6b7280;
		margin-top: 0.2rem;
	}

	.phases {
		margin-top: 1.1rem;
		display: grid;
		gap: 0.55rem;
	}

	.phase-row {
		display: grid;
		grid-template-columns: minmax(80px, 0.4fr) 1fr auto;
		align-items: center;
		gap: 0.6rem;
	}

	.phase-name {
		font-size: 0.85rem;
		color: #374151;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.phase-bar {
		height: 8px;
		background: #eef2f7;
		border-radius: 5px;
		overflow: hidden;
	}

	.phase-fill {
		display: block;
		height: 100%;
		background: #16a34a;
		border-radius: 5px;
		transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.phase-count {
		font-size: 0.8rem;
		color: #6b7280;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.pc-empty {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.pc-skeleton {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.sk-ring {
		width: 140px;
		height: 140px;
		border-radius: 50%;
		background: #f1f5f9;
		flex-shrink: 0;
	}

	.sk-lines {
		flex: 1;
		display: grid;
		gap: 0.6rem;
	}

	.sk-line {
		height: 14px;
		border-radius: 7px;
		background: #f1f5f9;
	}

	.sk-line.short {
		width: 60%;
	}

	.pc-skeleton .sk-ring,
	.pc-skeleton .sk-line {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	@media (max-width: 560px) {
		.pc-body {
			justify-content: center;
		}
		.kpis {
			min-width: 100%;
		}
	}
</style>
