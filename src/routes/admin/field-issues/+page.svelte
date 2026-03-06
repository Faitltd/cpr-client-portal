<script lang="ts">
	interface FieldIssue {
		id: string;
		deal_id: string;
		trade_partner_id: string | null;
		issue_type: string;
		severity: 'low' | 'medium' | 'high' | 'critical';
		title: string;
		description: string | null;
		photo_ids: string[] | null;
		status: 'open' | 'acknowledged' | 'resolved';
		resolved_at: string | null;
		created_at: string;
	}

	type StatusFilter = 'all' | 'open' | 'acknowledged' | 'resolved';

	const severityMeta: Array<{ value: FieldIssue['severity']; label: string }> = [
		{ value: 'critical', label: 'Critical' },
		{ value: 'high', label: 'High' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'low', label: 'Low' }
	];

	const filterOptions: Array<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'open', label: 'Open' },
		{ value: 'acknowledged', label: 'Acknowledged' },
		{ value: 'resolved', label: 'Resolved' }
	];

	let dealIdInput = '';
	let loadedDealId = '';
	let issues: FieldIssue[] = [];
	let loading = false;
	let loadError = '';
	let statusFilter: StatusFilter = 'open';
	let updatingId = '';
	let actionError = '';

	$: filteredIssues =
		statusFilter === 'all' ? issues : issues.filter((issue) => issue.status === statusFilter);

	$: severityGroups = severityMeta
		.map((meta) => ({
			...meta,
			items: filteredIssues.filter((issue) => issue.severity === meta.value)
		}))
		.filter((group) => group.items.length > 0);

	async function loadDeal() {
		const id = dealIdInput.trim();
		if (!id) return;
		loadedDealId = id;
		actionError = '';
		await fetchIssues();
	}

	async function fetchIssues() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/field-issues?dealId=${encodeURIComponent(loadedDealId)}`);
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Failed to load');
			issues = Array.isArray(json.data) ? json.data : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load field issues';
			issues = [];
		} finally {
			loading = false;
		}
	}

	async function updateStatus(id: string, status: FieldIssue['status']) {
		updatingId = id;
		actionError = '';
		try {
			const res = await fetch('/api/admin/field-issues', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, status })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Update failed');
			const updated = json.data as FieldIssue | undefined;
			if (!updated) throw new Error('Updated issue not returned');
			issues = issues.map((issue) => (issue.id === updated.id ? updated : issue));
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to update field issue';
		} finally {
			updatingId = '';
		}
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}

	function fmtIssueType(value: string) {
		return value
			.split('_')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}
</script>

<div class="container">
	<h1>Field Issues</h1>

	<div class="card loader-card">
		<label class="field-label" for="deal-id-input">Deal ID</label>
		<div class="loader-row">
			<input
				id="deal-id-input"
				class="input"
				type="text"
				placeholder="Enter Zoho Deal ID"
				bind:value={dealIdInput}
				on:keydown={(e) => e.key === 'Enter' && loadDeal()}
			/>
			<button class="btn btn-primary" on:click={loadDeal} disabled={!dealIdInput.trim()}>
				Load Issues
			</button>
		</div>
		{#if loadedDealId}
			<p class="muted" style="margin: 0.5rem 0 0;">
				Showing: <strong>{loadedDealId}</strong>
			</p>
		{/if}
	</div>

	{#if loadedDealId}
		<div class="card filter-card">
			<div class="filter-row">
				{#each filterOptions as option}
					<button
						class="btn"
						class:btn-primary={statusFilter === option.value}
						on:click={() => (statusFilter = option.value)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>

		{#if loading}
			<p class="muted">Loading…</p>
		{:else if loadError}
			<p class="error-text">{loadError}</p>
		{:else}
			{#if actionError}
				<p class="error-text" style="margin-bottom: 1rem;">{actionError}</p>
			{/if}

			{#if severityGroups.length === 0}
				<div class="empty">No {statusFilter === 'all' ? '' : statusFilter} issues found for this deal.</div>
			{:else}
				{#each severityGroups as group (group.value)}
					<section class="section">
						<h2>{group.label}</h2>
						<div class="issue-list">
							{#each group.items as issue (issue.id)}
								<div class="card issue-card">
									<div class="issue-header">
										<div class="issue-meta">
											<div class="badge-row">
												<span class="badge severity-{issue.severity}">{issue.severity}</span>
												<span class="badge badge-type">{fmtIssueType(issue.issue_type)}</span>
												<span class="badge status-{issue.status}">{issue.status}</span>
											</div>
											<span class="issue-title">{issue.title}</span>
										</div>
										<div class="issue-dates">
											<span class="muted">Created: {fmtDateTime(issue.created_at)}</span>
											<span class="muted">Partner: {issue.trade_partner_id ?? '—'}</span>
										</div>
									</div>

									{#if issue.description}
										<p class="issue-description">{issue.description}</p>
									{/if}

									<div class="action-buttons">
										{#if issue.status === 'open'}
											<button
												class="btn btn-ack"
												on:click={() => updateStatus(issue.id, 'acknowledged')}
												disabled={updatingId === issue.id}
											>
												{updatingId === issue.id ? 'Saving…' : 'Acknowledge'}
											</button>
										{/if}
										{#if issue.status === 'open' || issue.status === 'acknowledged'}
											<button
												class="btn btn-resolve"
												on:click={() => updateStatus(issue.id, 'resolved')}
												disabled={updatingId === issue.id}
											>
												{updatingId === issue.id ? 'Saving…' : 'Resolve'}
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			{/if}
		{/if}
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.6rem;
		color: #111827;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
		color: #111827;
	}

	.section {
		margin-bottom: 2rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.loader-card,
	.filter-card {
		margin-bottom: 2rem;
	}

	.loader-row,
	.filter-row,
	.action-buttons,
	.badge-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		margin-bottom: 0.25rem;
		display: block;
	}

	.input {
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font-size: 0.93rem;
		min-height: 44px;
		flex: 1;
		min-width: 0;
	}

	.input:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
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

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-primary {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: #0055aa;
	}

	.btn-ack {
		border-color: #bfdbfe;
		color: #1d4ed8;
		background: #eff6ff;
	}

	.btn-ack:hover:not(:disabled) {
		background: #dbeafe;
	}

	.btn-resolve {
		border-color: #a7f3d0;
		color: #166534;
		background: #ecfdf5;
	}

	.btn-resolve:hover:not(:disabled) {
		background: #d1fae5;
	}

	.issue-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.issue-card {
		padding: 1.25rem;
	}

	.issue-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.issue-meta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.issue-title {
		font-weight: 600;
		color: #111827;
		font-size: 0.97rem;
	}

	.issue-dates {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.83rem;
	}

	.issue-description {
		color: #4b5563;
		font-size: 0.9rem;
		margin: 0 0 0.85rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.badge-type {
		background: #f3f4f6;
		color: #374151;
	}

	.severity-critical {
		background: #dc2626;
		color: #fff;
	}

	.severity-high {
		background: #f59e0b;
		color: #111827;
	}

	.severity-medium {
		background: #e5e7eb;
		color: #111827;
	}

	.severity-low {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-open {
		background: #fef3c7;
		color: #92400e;
	}

	.status-acknowledged {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-resolved {
		background: #d1fae5;
		color: #065f46;
	}

	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.loader-row,
		.filter-row {
			flex-direction: column;
			align-items: stretch;
		}

		.issue-header {
			flex-direction: column;
		}

		.issue-dates {
			align-items: flex-start;
		}
	}
</style>
