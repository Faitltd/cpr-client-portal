<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	const { dealId, scope, taskSet } = data;
	const generatedDate = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(new Date());

	function handlePrint() {
		window.print();
	}

	function formatProjectType(value: string) {
		return value
			.split('_')
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function formatLabel(value: string) {
		return value
			.split('_')
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		}).format(date);
	}

	function formatArea(area: { name: string; sqft?: number }) {
		if (area.sqft) {
			return `${area.name} (${area.sqft} sqft)`;
		}
		return area.name;
	}

	const specialConditions = Object.entries(scope.special_conditions ?? {}).filter(
		([, value]) => value === true || (typeof value === 'string' && value.trim().length > 0)
	);

	const groupedTasks = taskSet.phases
		.map((phase) => ({
			phase,
			tasks: taskSet.tasks.filter((task) => task.phase === phase.name)
		}))
		.filter((group) => group.tasks.length > 0);
</script>

<svelte:head>
	<title>Scope of Work - {dealId}</title>
</svelte:head>

<div class="sow-page">
	<div class="toolbar no-print">
		<a class="toolbar-link" href="/admin/scope/{dealId}">Back to Scope Editor</a>
		<button class="print-button" type="button" on:click={handlePrint}>Print / Save as PDF</button>
	</div>

	<header class="company-header">
		<h1>Custom Professional Renovation</h1>
		<p>Scope of Work</p>
	</header>

	<section class="section">
		<h2>Project Info</h2>
		<div class="info-grid">
			<div class="info-row">
				<span class="info-label">Deal ID</span>
				<span class="info-value">{dealId}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Project Type</span>
				<span class="info-value">{formatProjectType(scope.project_type)}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Areas</span>
				<span class="info-value">{scope.areas.map(formatArea).join(', ') || '—'}</span>
			</div>
			<div class="info-row">
				<span class="info-label">Date Generated</span>
				<span class="info-value">{generatedDate}</span>
			</div>
		</div>
	</section>

	<section class="section">
		<h2>Scope Summary</h2>

		{#if scope.included_items.length > 0}
			<div class="summary-block">
				<h3>Included Items</h3>
				<ul>
					{#each scope.included_items as item}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if scope.excluded_items.length > 0}
			<div class="summary-block">
				<h3>Excluded Items</h3>
				<ul>
					{#each scope.excluded_items as item}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if scope.selections_needed.length > 0}
			<div class="summary-block">
				<h3>Selections Needed</h3>
				<ul>
					{#each scope.selections_needed as item}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if specialConditions.length > 0}
			<div class="summary-block">
				<h3>Special Conditions</h3>
				<ul class="key-value-list">
					{#each specialConditions as [key, value]}
						<li>
							<strong>{formatLabel(key)}:</strong>
							{value === true ? 'Yes' : String(value)}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if scope.long_lead_items.length > 0}
			<div class="summary-block">
				<h3>Long Lead Items</h3>
				<ul>
					{#each scope.long_lead_items as item}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="summary-block">
			<h3>Permit Required</h3>
			<p>{scope.permit_required ? 'Yes' : 'No'}</p>
		</div>

		{#if scope.trade_notes}
			<div class="summary-block">
				<h3>Trade Notes</h3>
				<p>{scope.trade_notes}</p>
			</div>
		{/if}
	</section>

	<section class="section">
		<h2>Task Schedule</h2>

		<table class="schedule-table">
			<thead>
				<tr>
					<th>Task Name</th>
					<th>Trade</th>
					<th>Duration (days)</th>
					<th>Start Date</th>
					<th>End Date</th>
					<th>Notes</th>
				</tr>
			</thead>
			<tbody>
				{#each groupedTasks as group}
					<tr class="phase-row">
						<td colspan="6">{formatLabel(group.phase.name)}</td>
					</tr>
					{#each group.tasks as task}
						<tr class="task-row">
							<td>{task.task_name}</td>
							<td>{task.trade ? formatLabel(task.trade) : '—'}</td>
							<td>{task.duration_days}</td>
							<td>{formatDate(task.start_date)}</td>
							<td>{formatDate(task.end_date)}</td>
							<td>
								<div class="note-badges">
									{#if task.requires_client_decision}
										<span class="badge badge-decision">Client decision</span>
									{/if}
									{#if task.requires_inspection}
										<span class="badge badge-inspection">Inspection</span>
									{/if}
									{#if !task.requires_client_decision && !task.requires_inspection}
										<span>—</span>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</section>

	<section class="section summary-footer">
		<h2>Summary</h2>
		<div class="summary-grid">
			<div class="summary-metric">
				<span class="metric-label">Total tasks</span>
				<span class="metric-value">{taskSet.summary.total_tasks}</span>
			</div>
			<div class="summary-metric">
				<span class="metric-label">Estimated duration</span>
				<span class="metric-value">{taskSet.summary.total_duration_days} days</span>
			</div>
			<div class="summary-metric">
				<span class="metric-label">Tasks requiring client decisions</span>
				<span class="metric-value">{taskSet.summary.tasks_requiring_decisions}</span>
			</div>
			<div class="summary-metric">
				<span class="metric-label">Tasks requiring inspections</span>
				<span class="metric-value">{taskSet.summary.tasks_requiring_inspections}</span>
			</div>
		</div>
	</section>

	<footer class="document-footer">
		Generated on {generatedDate}. This document is for planning purposes.
	</footer>
</div>

<style>
	:global(.admin-header),
	:global(.admin-footer) {
		display: none;
	}

	:global(.admin-shell) {
		background: #fff;
	}

	:global(.admin-content) {
		padding: 0;
	}

	:global(body) {
		margin: 0;
		color: #111;
		background: #fff;
		font-family: system-ui, -apple-system, Helvetica, Arial, sans-serif;
	}

	.sow-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	.toolbar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.9rem 1rem;
		margin-bottom: 2rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #f8fafc;
	}

	.toolbar-link,
	.print-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.65rem 1.1rem;
		border-radius: 999px;
		font-weight: 700;
		text-decoration: none;
		box-sizing: border-box;
	}

	.toolbar-link {
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
	}

	.print-button {
		border: 1px solid #0066cc;
		background: #0066cc;
		color: #fff;
		cursor: pointer;
		font: inherit;
	}

	.company-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.company-header h1 {
		margin: 0;
		font-size: 1.9rem;
		font-weight: 800;
	}

	.company-header p {
		margin: 0.4rem 0 0;
		font-size: 1rem;
		color: #4b5563;
	}

	.section {
		margin-bottom: 2rem;
	}

	.section h2 {
		margin: 0 0 1rem;
		font-size: 1.15rem;
		font-weight: 700;
		border-bottom: 1px solid #ddd;
		padding-bottom: 0.45rem;
	}

	.summary-block {
		margin-bottom: 1rem;
	}

	.summary-block h3 {
		margin: 0 0 0.5rem;
		font-size: 0.98rem;
	}

	.summary-block p,
	.summary-block li {
		line-height: 1.5;
	}

	.summary-block ul,
	.key-value-list {
		margin: 0;
		padding-left: 1.2rem;
	}

	.info-grid,
	.summary-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.85rem 1.5rem;
	}

	.info-row,
	.summary-metric {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.info-label,
	.metric-label {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.info-value,
	.metric-value {
		font-size: 1rem;
		font-weight: 600;
	}

	.schedule-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}

	.schedule-table th,
	.schedule-table td {
		border: 1px solid #ddd;
		padding: 0.5rem;
		text-align: left;
		vertical-align: top;
	}

	.schedule-table th {
		background: #f9fafb;
		font-weight: 700;
	}

	.phase-row {
		break-inside: avoid;
	}

	.phase-row td {
		background: #f0f0f0;
		font-weight: 700;
		text-transform: capitalize;
	}

	.task-row {
		break-inside: avoid;
	}

	.note-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.badge-decision {
		background: #e0e7ff;
		color: #3730a3;
	}

	.badge-inspection {
		background: #fef3c7;
		color: #92400e;
	}

	.document-footer {
		text-align: center;
		font-size: 0.85rem;
		color: #6b7280;
		margin-top: 2rem;
	}

	@media (max-width: 720px) {
		.sow-page {
			padding: 1.25rem;
		}

		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.info-grid,
		.summary-grid {
			grid-template-columns: 1fr;
		}

		.schedule-table {
			font-size: 0.85rem;
		}
	}

	@media print {
		.no-print {
			display: none;
		}

		:global(.admin-content) {
			padding: 0;
		}

		.sow-page {
			max-width: none;
			padding: 0;
		}

		.section,
		.summary-block,
		.phase-row,
		.task-row,
		.schedule-table tbody {
			break-inside: avoid;
		}
	}

	@page {
		margin: 0.75in;
		size: letter;
	}
</style>
