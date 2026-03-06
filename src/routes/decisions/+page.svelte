<script lang="ts">
	import { onMount } from 'svelte';

	interface Approval {
		id: string;
		deal_id: string;
		deal_name: string;
		title: string;
		description: string | null;
		category: string;
		status: string;
		assigned_to: string;
		priority: string;
		due_date: string | null;
		response_note: string | null;
		created_by: string | null;
		created_at: string;
		updated_at: string;
	}

	let decisions: Approval[] = [];
	let loading = true;
	let error = '';

	// Action state
	let activeId = '';
	let activeStatus = '';
	let responseNote = '';
	let submitting = false;
	let actionError = '';

	async function fetchDecisions() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/client/decisions');
			if (res.status === 401) {
				window.location.href = '/auth/client';
				return;
			}
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				throw new Error(json.message || `Failed to load (${res.status})`);
			}
			const json = await res.json();
			decisions = json.data ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load decisions';
		} finally {
			loading = false;
		}
	}

	onMount(fetchDecisions);

	function startAction(id: string, status: string) {
		activeId = id;
		activeStatus = status;
		responseNote = '';
		actionError = '';
	}

	function cancelAction() {
		activeId = '';
		activeStatus = '';
		responseNote = '';
		actionError = '';
	}

	async function confirmAction() {
		if (!activeId) return;
		submitting = true;
		actionError = '';
		try {
			const res = await fetch('/api/client/decisions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: activeId,
					status: activeStatus,
					response_note: responseNote.trim() || undefined
				})
			});
			if (res.status === 401) {
				window.location.href = '/auth/client';
				return;
			}
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.message || 'Update failed');
			cancelAction();
			await fetchDecisions();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Update failed';
		} finally {
			submitting = false;
		}
	}

	// Group decisions by deal_name
	$: grouped = decisions.reduce<Record<string, Approval[]>>((acc, item) => {
		const key = item.deal_name || item.deal_id;
		if (!acc[key]) acc[key] = [];
		acc[key].push(item);
		return acc;
	}, {});

	$: dealGroups = Object.entries(grouped);

	const priorityClass: Record<string, string> = {
		urgent: 'badge-urgent',
		high: 'badge-high',
		normal: 'badge-normal',
		low: 'badge-low'
	};

	function fmtShortDate(value: string | null) {
		if (!value) return null;
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return value;
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function fmtDate(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}

	function isOverdue(due_date: string | null) {
		if (!due_date) return false;
		return new Date(due_date) < new Date();
	}
</script>

<div class="dashboard">
	<header>
		<a class="back-link" href="/dashboard">← Back to Dashboard</a>
		<h1>Your Decisions</h1>
		<p class="subtitle">Items that need your approval or input</p>
	</header>

	{#if loading}
		<p class="muted">Loading decisions...</p>
	{:else if error}
		<div class="error-banner">
			<p>{error}</p>
			<button class="btn btn-retry" type="button" on:click={fetchDecisions}>Retry</button>
		</div>
	{:else if decisions.length === 0}
		<div class="empty">
			<span class="check-icon">✓</span>
			<p>No decisions pending — you're all caught up.</p>
		</div>
	{:else}
		{#each dealGroups as [dealName, items] (dealName)}
			<section class="deal-group">
				<div class="deal-heading">
					<h2>{dealName}</h2>
					<span class="count-badge">{items.length}</span>
				</div>

				<div class="approval-list">
					{#each items as item (item.id)}
						<div class="card approval-card">
							<div class="approval-header">
								<div class="approval-meta">
									<span class="approval-title">{item.title}</span>
									<div class="badge-row">
										<span class="badge badge-category">{item.category}</span>
										<span class="badge {priorityClass[item.priority] ?? 'badge-normal'}">{item.priority}</span>
									</div>
								</div>
								<div class="approval-dates">
									{#if item.due_date}
										<span class="due-date" class:overdue={isOverdue(item.due_date)}>
											Due: {fmtShortDate(item.due_date)}
											{#if isOverdue(item.due_date)}<span class="overdue-label">Overdue</span>{/if}
										</span>
									{/if}
									<span class="muted">Created: {fmtDate(item.created_at)}</span>
								</div>
							</div>

							{#if item.description}
								<p class="approval-description">{item.description}</p>
							{/if}

							{#if activeId === item.id}
								<div class="action-confirm">
									<p class="action-label">
										{activeStatus === 'approved' ? 'Approving' : 'Declining'} — add a note (optional):
									</p>
									<textarea
										class="textarea"
										rows="2"
										placeholder="Response note…"
										bind:value={responseNote}
									></textarea>
									{#if actionError}
										<p class="error-text">{actionError}</p>
									{/if}
									<div class="action-buttons">
										<button
											class="btn btn-confirm"
											class:btn-danger={activeStatus === 'rejected'}
											on:click={confirmAction}
											disabled={submitting}
										>
											{submitting ? 'Saving…' : 'Confirm'}
										</button>
										<button class="btn btn-cancel" on:click={cancelAction} disabled={submitting}>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<div class="action-buttons">
									<button class="btn btn-approve" on:click={() => startAction(item.id, 'approved')}>
										Approve
									</button>
									<button class="btn btn-decline" on:click={() => startAction(item.id, 'rejected')}>
										Decline
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

<style>
	.dashboard {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		color: #0066cc;
		text-decoration: none;
		font-size: 0.95rem;
		margin-bottom: 0.75rem;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.6rem;
		color: #111827;
	}

	.subtitle {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
	}

	.muted {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 1rem 1.25rem;
		color: #b91c1c;
	}

	.error-banner p {
		margin: 0;
	}

	.btn-retry {
		border: 1px solid #fca5a5;
		background: #fff;
		color: #b91c1c;
		border-radius: 10px;
		padding: 0.5rem 1rem;
		font-weight: 700;
		min-height: 44px;
		cursor: pointer;
		font-size: 0.9rem;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 3rem 1.5rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	.check-icon {
		display: block;
		font-size: 2rem;
		color: #059669;
		margin-bottom: 0.5rem;
	}

	.empty p {
		margin: 0;
		font-size: 1rem;
	}

	.deal-group {
		margin-bottom: 2rem;
	}

	.deal-heading {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.85rem;
	}

	.deal-heading h2 {
		margin: 0;
		font-size: 1.05rem;
		color: #111827;
	}

	.count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #111827;
		color: #fff;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		padding: 0.15rem 0.55rem;
		min-width: 1.5rem;
	}

	.approval-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.approval-card {
		padding: 1.25rem;
	}

	.approval-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.approval-meta {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.approval-title {
		font-weight: 700;
		color: #111827;
		font-size: 1rem;
	}

	.badge-row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.badge-category {
		background: #111827;
		color: #fff;
	}

	.badge-urgent {
		background: #dc2626;
		color: #fff;
	}

	.badge-high {
		background: #f59e0b;
		color: #1c1917;
	}

	.badge-normal {
		background: #e5e7eb;
		color: #374151;
	}

	.badge-low {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.approval-dates {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		font-size: 0.85rem;
	}

	.due-date {
		color: #374151;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.due-date.overdue {
		color: #b91c1c;
		font-weight: 600;
	}

	.overdue-label {
		font-size: 0.75rem;
		font-weight: 800;
		background: #fee2e2;
		color: #b91c1c;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
	}

	.approval-description {
		color: #4b5563;
		font-size: 0.92rem;
		margin: 0 0 0.85rem;
		line-height: 1.5;
	}

	.action-confirm {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid #e5e7eb;
		padding-top: 0.85rem;
		margin-top: 0.5rem;
	}

	.action-label {
		margin: 0;
		font-size: 0.88rem;
		color: #374151;
		font-weight: 600;
	}

	.textarea {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		font-size: 0.93rem;
		resize: vertical;
		width: 100%;
		box-sizing: border-box;
		font-family: inherit;
	}

	.textarea:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0;
	}

	.action-buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem 1.25rem;
		border-radius: 10px;
		font-weight: 700;
		min-height: 44px;
		cursor: pointer;
		font-size: 0.95rem;
		white-space: nowrap;
		border: none;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-approve {
		background: #059669;
		color: #fff;
	}

	.btn-approve:hover:not(:disabled) {
		background: #047857;
	}

	.btn-decline {
		background: #dc2626;
		color: #fff;
	}

	.btn-decline:hover:not(:disabled) {
		background: #b91c1c;
	}

	.btn-confirm {
		background: #0066cc;
		color: #fff;
	}

	.btn-confirm:hover:not(:disabled) {
		background: #0052a3;
	}

	.btn-danger {
		background: #dc2626 !important;
		color: #fff !important;
	}

	.btn-danger:hover:not(:disabled) {
		background: #b91c1c !important;
	}

	.btn-cancel {
		background: #f9fafb;
		color: #111827;
		border: 1px solid #d1d5db;
	}

	.btn-cancel:hover:not(:disabled) {
		background: #f3f4f6;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1.5rem 1.25rem;
		}

		.approval-header {
			flex-direction: column;
		}

		.approval-dates {
			align-items: flex-start;
		}

		.action-buttons .btn {
			width: 100%;
		}
	}
</style>
