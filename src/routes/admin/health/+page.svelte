<script lang="ts">
	import { onMount } from 'svelte';

	interface HealthProject {
		deal_id: string;
		project_name: string;
		score: number;
		signals: {
			schedule: number;
			budget: number;
			issues: number;
			decisions: number;
			comms: number;
		};
		status: 'healthy' | 'warning' | 'critical';
	}

	type SignalKey = keyof HealthProject['signals'];

	const signalMeta: Array<{ key: SignalKey; label: string }> = [
		{ key: 'schedule', label: 'Schedule' },
		{ key: 'budget', label: 'Budget' },
		{ key: 'issues', label: 'Issues' },
		{ key: 'decisions', label: 'Decisions' },
		{ key: 'comms', label: 'Comms' }
	];

	let projects: HealthProject[] = [];
	let loading = true;
	let loadError = '';

	$: totalProjects = projects.length;
	$: healthyCount = projects.filter((project) => project.status === 'healthy').length;
	$: warningCount = projects.filter((project) => project.status === 'warning').length;
	$: criticalCount = projects.filter((project) => project.status === 'critical').length;

	onMount(() => {
		loadProjects();
	});

	async function loadProjects() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/admin/health');
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Failed to load project health');
			projects = Array.isArray(json.data) ? json.data : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load project health';
			projects = [];
		} finally {
			loading = false;
		}
	}

	function statusLabel(status: HealthProject['status']) {
		if (status === 'healthy') return 'Healthy';
		if (status === 'warning') return 'Warning';
		return 'Critical';
	}

	function scoreColor(score: number) {
		if (score >= 70) return '#10b981';
		if (score >= 50) return '#f59e0b';
		return '#ef4444';
	}

	function trackColor(score: number) {
		if (score >= 70) return '#d1fae5';
		if (score >= 50) return '#fef3c7';
		return '#fee2e2';
	}

	function statusBorder(status: HealthProject['status']) {
		if (status === 'healthy') return '#10b981';
		if (status === 'warning') return '#f59e0b';
		return '#ef4444';
	}
</script>

<div class="container">
	<a class="back-link" href="/admin/clients">← Back to Clients</a>
	<h1>Project Health</h1>

	{#if loading}
		<div class="card state-card">
			<p class="muted">Loading project health…</p>
		</div>
	{:else if loadError}
		<div class="card state-card">
			<p class="error-text">{loadError}</p>
			<button class="btn btn-primary" type="button" on:click={loadProjects}>Retry</button>
		</div>
	{:else if projects.length === 0}
		<div class="card state-card">
			<p class="muted">No project health data available.</p>
		</div>
	{:else}
		<div class="summary-grid">
			<div class="card summary-card">
				<span class="summary-label">Total Projects</span>
				<span class="summary-value">{totalProjects}</span>
			</div>
			<div class="card summary-card summary-healthy">
				<span class="summary-label">Healthy</span>
				<span class="summary-value">{healthyCount}</span>
				<span class="badge badge-healthy">Healthy</span>
			</div>
			<div class="card summary-card summary-warning">
				<span class="summary-label">Warning</span>
				<span class="summary-value">{warningCount}</span>
				<span class="badge badge-warning">Warning</span>
			</div>
			<div class="card summary-card summary-critical">
				<span class="summary-label">Critical</span>
				<span class="summary-value">{criticalCount}</span>
				<span class="badge badge-critical">Critical</span>
			</div>
		</div>

		<div class="project-list">
			{#each projects as project (project.deal_id)}
				<div class="card health-card" style={`border-left-color: ${statusBorder(project.status)};`}>
					<div class="project-header">
						<div class="project-meta">
							<span class="project-name">{project.project_name}</span>
							<span class="muted">Deal ID: {project.deal_id}</span>
						</div>

						<div class="project-score-group">
							<span class="project-score" style={`color: ${scoreColor(project.score)};`}>
								{project.score}
							</span>
							<span class={`badge badge-${project.status}`}>{statusLabel(project.status)}</span>
						</div>
					</div>

					<div class="signal-grid">
						{#each signalMeta as signal}
							<div class="signal-card">
								<div class="signal-row">
									<span class="signal-label">{signal.label}</span>
									<span class="signal-value" style={`color: ${scoreColor(project.signals[signal.key])};`}>
										{project.signals[signal.key]}/100
									</span>
								</div>
								<div class="signal-bar" style={`background: ${trackColor(project.signals[signal.key])};`}>
									<div
										class="signal-fill"
										style={`width: ${project.signals[signal.key]}%; background: ${scoreColor(project.signals[signal.key])};`}
									></div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	.back-link {
		display: inline-flex;
		margin-bottom: 0.75rem;
		color: #0066cc;
		font-weight: 600;
		text-decoration: none;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.6rem;
		color: #111827;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.state-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.summary-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.summary-label {
		color: #6b7280;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.summary-value {
		font-size: 1.75rem;
		font-weight: 800;
		color: #111827;
		line-height: 1;
	}

	.project-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.health-card {
		border-left: 4px solid #10b981;
	}

	.project-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.project-meta {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.project-name {
		font-size: 1.05rem;
		font-weight: 700;
		color: #111827;
	}

	.project-score-group {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.project-score {
		font-size: 2rem;
		font-weight: 800;
		line-height: 1;
	}

	.signal-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.signal-card {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #fafafa;
	}

	.signal-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}

	.signal-label {
		font-size: 0.86rem;
		font-weight: 700;
		color: #374151;
	}

	.signal-value {
		font-size: 0.86rem;
		font-weight: 800;
	}

	.signal-bar {
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		background: #e5e7eb;
	}

	.signal-fill {
		height: 100%;
		border-radius: 3px;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.badge-healthy {
		background: #d1fae5;
		color: #065f46;
	}

	.badge-warning {
		background: #fef3c7;
		color: #92400e;
	}

	.badge-critical {
		background: #fee2e2;
		color: #b91c1c;
	}

	.summary-healthy {
		border-color: #a7f3d0;
	}

	.summary-warning {
		border-color: #fcd34d;
	}

	.summary-critical {
		border-color: #fca5a5;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1.1rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		color: #1a1a1a;
		min-height: 44px;
		cursor: pointer;
		font-size: 0.93rem;
		white-space: nowrap;
	}

	.btn:hover:not(:disabled) {
		background: #f3f4f6;
	}

	.btn-primary {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: #0055aa;
	}

	.muted {
		color: #6b7280;
		font-size: 0.88rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.92rem;
		margin: 0;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.project-header,
		.state-card {
			flex-direction: column;
			align-items: flex-start;
		}

		.project-score-group {
			align-items: flex-start;
		}

		.signal-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
