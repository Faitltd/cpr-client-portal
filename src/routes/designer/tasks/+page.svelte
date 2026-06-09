<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
	$: deals = data.dealsWithTasks ?? [];
</script>

<svelte:head>
	<title>Tasks · Designer · CPR Portal</title>
</svelte:head>

{#if data.warning}
	<div class="warning">{data.warning}</div>
{/if}

{#if deals.length === 0}
	<div class="empty">No tasks found on active deals.</div>
{:else}
	<div class="deal-list">
		{#each deals as deal (deal.id)}
			<section class="deal-card">
				<header class="deal-head">
					<div class="deal-head-main">
						<h2>{deal.name}</h2>
						<p class="meta">
							{#if deal.stage}<span class="badge">{deal.stage}</span>{/if}
							{#if deal.contactName}<span class="muted">{deal.contactName}</span>{/if}
							{#if deal.ballInCourt}<span class="muted">· Ball in court: {deal.ballInCourt}</span
								>{/if}
						</p>
					</div>
					<div class="progress">{deal.completedCount}/{deal.taskCount} done</div>
				</header>
				<ul class="tasks">
					{#each deal.tasks as task (task.id)}
						<li class:done={task.completed}>
							<span class="check" aria-hidden="true">{task.completed ? '✓' : '○'}</span>
							<span class="task-name">{task.name}</span>
							{#if task.status}<span class="status">{task.status}</span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{/if}

<style>
	.deal-list {
		display: grid;
		gap: 0.75rem;
	}

	.deal-card {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 1rem 1.1rem;
	}

	.deal-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.deal-head-main h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #0f172a;
	}

	.meta {
		margin: 0.3rem 0 0;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}

	.badge {
		background: #eef2f7;
		color: #1f2937;
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		font-weight: 600;
	}

	.muted {
		color: #6b7280;
	}

	.progress {
		font-size: 0.85rem;
		font-weight: 600;
		color: #334155;
		white-space: nowrap;
	}

	.tasks {
		list-style: none;
		margin: 0.85rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}

	.tasks li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: #f9fafb;
		font-size: 0.9rem;
		color: #111827;
	}

	.tasks li.done .task-name {
		color: #6b7280;
		text-decoration: line-through;
	}

	.check {
		color: #b45309;
		font-weight: 700;
	}

	.tasks li.done .check {
		color: #16a34a;
	}

	.task-name {
		flex: 1;
	}

	.status {
		font-size: 0.78rem;
		color: #6b7280;
		background: #eef2f7;
		border-radius: 999px;
		padding: 0.05rem 0.55rem;
	}

	.warning {
		border: 1px solid #fde68a;
		background: #fffbeb;
		color: #92400e;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
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
