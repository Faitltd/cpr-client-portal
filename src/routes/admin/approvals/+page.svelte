<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	interface Approval {
		id: string;
		deal_id: string;
		title: string;
		description: string | null;
		category: string;
		assigned_to: string;
		status: string;
		priority: string;
		due_date: string | null;
		responded_at: string | null;
		response_note: string | null;
		created_by: string | null;
		created_at: string;
		updated_at: string;
	}

	// Deal loader
	let dealIdInput = '';
	let loadedDealId = '';

	// Data
	let pending: Approval[] = [];
	let allApprovals: Approval[] = [];

	// Loading states
	let loading = false;
	let loadError = '';

	// Action state (inline confirm flow)
	let activeId = '';
	let activeStatus = '';
	let responseNote = '';
	let submitting = false;
	let actionError = '';

	// Create form
	let createTitle = '';
	let createDescription = '';
	let createCategory = 'general';
	let createAssignedTo = 'client';
	let createPriority = 'normal';
	let createDueDate = '';
	let creating = false;
	let createError = '';
	let createSuccess = false;

	async function loadDeal() {
		const id = dealIdInput.trim();
		if (!id) return;
		loadedDealId = id;
		createSuccess = false;
		await Promise.all([fetchPending(), fetchAll()]);
	}

	async function fetchPending() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(
				`/api/admin/approvals?dealId=${encodeURIComponent(loadedDealId)}&status=pending`
			);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load');
			pending = json.data ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load pending approvals';
		} finally {
			loading = false;
		}
	}

	async function fetchAll() {
		try {
			const res = await fetch(
				`/api/admin/approvals?dealId=${encodeURIComponent(loadedDealId)}`
			);
			const json = await res.json();
			if (res.ok) allApprovals = json.data ?? [];
		} catch {
			// history section fails silently
		}
	}

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
			const res = await fetch(`/api/admin/approvals/${activeId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: activeStatus,
					responseNote: responseNote.trim() || undefined
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Update failed');
			cancelAction();
			await Promise.all([fetchPending(), fetchAll()]);
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Update failed';
		} finally {
			submitting = false;
		}
	}

	async function submitCreate() {
		if (!createTitle.trim()) return;
		creating = true;
		createError = '';
		createSuccess = false;
		try {
			const res = await fetch('/api/admin/approvals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dealId: loadedDealId,
					title: createTitle.trim(),
					description: createDescription.trim() || undefined,
					category: createCategory,
					assignedTo: createAssignedTo,
					priority: createPriority,
					dueDate: createDueDate || undefined
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Create failed');
			createTitle = '';
			createDescription = '';
			createCategory = 'general';
			createAssignedTo = 'client';
			createPriority = 'normal';
			createDueDate = '';
			createSuccess = true;
			await Promise.all([fetchPending(), fetchAll()]);
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Create failed';
		} finally {
			creating = false;
		}
	}

	const priorityClass: Record<string, string> = {
		urgent: 'badge-urgent',
		high: 'badge-high',
		normal: 'badge-normal',
		low: 'badge-low'
	};

	const statusClass: Record<string, string> = {
		pending: 'badge-pending',
		approved: 'badge-approved',
		rejected: 'badge-rejected',
		deferred: 'badge-deferred'
	};

	function fmtDate(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}
</script>

<div class="container">
	<h1>Approvals Queue</h1>

	<!-- Deal ID loader -->
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
				Load
			</button>
		</div>
		{#if loadedDealId}
			<p class="muted" style="margin: 0.5rem 0 0;">
				Showing: <strong>{loadedDealId}</strong>
			</p>
		{/if}
	</div>

	{#if loadedDealId}
		<!-- Pending approvals -->
		<section class="section">
			<h2>Pending Approvals</h2>

			{#if loading}
				<p class="muted">Loading…</p>
			{:else if loadError}
				<p class="error-text">{loadError}</p>
			{:else if pending.length === 0}
				<div class="empty">No pending approvals for this deal.</div>
			{:else}
				<div class="approval-list">
					{#each pending as item (item.id)}
						<div class="card approval-card">
							<div class="approval-header">
								<div class="approval-meta">
									<span class="approval-title">{item.title}</span>
									<div class="badge-row">
										<span class="badge badge-category">{item.category}</span>
										<span class="badge {priorityClass[item.priority] ?? 'badge-normal'}">{item.priority}</span>
										<span class="badge badge-assignee">{item.assigned_to}</span>
									</div>
								</div>
								<div class="approval-dates">
									{#if item.due_date}
										<span class="muted">Due: {fmtDate(item.due_date)}</span>
									{/if}
									<span class="muted">Created: {fmtDate(item.created_at)}</span>
								</div>
							</div>

							{#if item.description}
								<p class="approval-description">{item.description}</p>
							{/if}

							{#if activeId === item.id}
								<!-- Inline confirm flow -->
								<div class="action-confirm">
									<p class="action-label">
										{activeStatus === 'approved' ? 'Approving' : activeStatus === 'rejected' ? 'Rejecting' : 'Deferring'} — add a note (optional):
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
										<button class="btn" on:click={cancelAction} disabled={submitting}>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<div class="action-buttons">
									<button class="btn btn-approve" on:click={() => startAction(item.id, 'approved')}>
										Approve
									</button>
									<button class="btn btn-reject" on:click={() => startAction(item.id, 'rejected')}>
										Reject
									</button>
									<button class="btn btn-defer" on:click={() => startAction(item.id, 'deferred')}>
										Defer
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Create approval form -->
		<section class="section">
			<h2>New Approval Item</h2>
			<div class="card">
				<form on:submit|preventDefault={submitCreate}>
					<div class="field">
						<label class="field-label" for="create-title">Title <span class="required">*</span></label>
						<input
							id="create-title"
							class="input"
							type="text"
							placeholder="e.g. Approve tile selection"
							bind:value={createTitle}
							required
						/>
					</div>

					<div class="field">
						<label class="field-label" for="create-description">Description</label>
						<textarea
							id="create-description"
							class="textarea"
							rows="3"
							placeholder="Additional context or details…"
							bind:value={createDescription}
						></textarea>
					</div>

					<div class="field-row">
						<div class="field">
							<label class="field-label" for="create-category">Category</label>
							<select id="create-category" class="select" bind:value={createCategory}>
								<option value="general">General</option>
								<option value="selection">Selection</option>
								<option value="design">Design</option>
								<option value="change_order">Change Order</option>
								<option value="schedule">Schedule</option>
								<option value="budget">Budget</option>
							</select>
						</div>

						<div class="field">
							<label class="field-label" for="create-assigned">Assigned To</label>
							<select id="create-assigned" class="select" bind:value={createAssignedTo}>
								<option value="client">Client</option>
								<option value="admin">Admin</option>
							</select>
						</div>

						<div class="field">
							<label class="field-label" for="create-priority">Priority</label>
							<select id="create-priority" class="select" bind:value={createPriority}>
								<option value="low">Low</option>
								<option value="normal">Normal</option>
								<option value="high">High</option>
								<option value="urgent">Urgent</option>
							</select>
						</div>

						<div class="field">
							<label class="field-label" for="create-due">Due Date</label>
							<input
								id="create-due"
								class="input"
								type="date"
								bind:value={createDueDate}
							/>
						</div>
					</div>

					{#if createError}
						<p class="error-text">{createError}</p>
					{/if}
					{#if createSuccess}
						<p class="success-text">Approval item created.</p>
					{/if}

					<div class="form-footer">
						<button class="btn btn-primary" type="submit" disabled={creating || !createTitle.trim()}>
							{creating ? 'Creating…' : 'Create Approval'}
						</button>
					</div>
				</form>
			</div>
		</section>

		<!-- History -->
		<section class="section">
			<details class="history-details">
				<summary class="history-summary">All Approvals ({allApprovals.length})</summary>
				{#if allApprovals.length === 0}
					<div class="empty" style="margin-top: 1rem;">No approval history yet.</div>
				{:else}
					<div class="history-list">
						{#each allApprovals as item (item.id)}
							<div class="history-row">
								<div class="history-main">
									<span class="approval-title">{item.title}</span>
									<div class="badge-row">
										<span class="badge badge-category">{item.category}</span>
										<span class="badge {statusClass[item.status] ?? 'badge-pending'}">{item.status}</span>
										<span class="badge {priorityClass[item.priority] ?? 'badge-normal'}">{item.priority}</span>
									</div>
								</div>
								<div class="history-meta">
									<span class="muted">Assigned: {item.assigned_to}</span>
									{#if item.responded_at}
										<span class="muted">Responded: {fmtDateTime(item.responded_at)}</span>
									{/if}
									{#if item.response_note}
										<span class="muted note">Note: {item.response_note}</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</details>
		</section>
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

	.loader-card {
		margin-bottom: 2rem;
	}

	.loader-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
	}

	.field-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		margin-bottom: 0.25rem;
		display: block;
	}

	.required {
		color: #b91c1c;
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

	.select {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.93rem;
		min-height: 44px;
		background: #fff;
		width: 100%;
	}

	.select:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
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

	.btn-approve {
		border-color: #bbf7d0;
		color: #166534;
		background: #f0fdf4;
	}

	.btn-approve:hover:not(:disabled) {
		background: #dcfce7;
	}

	.btn-reject {
		border-color: #fca5a5;
		color: #b91c1c;
		background: #fff5f5;
	}

	.btn-reject:hover:not(:disabled) {
		background: #fee2e2;
	}

	.btn-defer {
		border-color: #e9d5ff;
		color: #6b21a8;
		background: #faf5ff;
	}

	.btn-defer:hover:not(:disabled) {
		background: #f3e8ff;
	}

	.btn-confirm {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
	}

	.btn-confirm:hover:not(:disabled) {
		background: #0055aa;
	}

	.btn-danger {
		background: #dc2626 !important;
		border-color: #dc2626 !important;
		color: #fff !important;
	}

	.btn-danger:hover:not(:disabled) {
		background: #b91c1c !important;
	}

	/* Approval cards */
	.approval-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
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
		font-weight: 600;
		color: #111827;
		font-size: 0.97rem;
	}

	.approval-dates {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.83rem;
	}

	.approval-description {
		color: #4b5563;
		font-size: 0.9rem;
		margin: 0 0 0.85rem;
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
		font-size: 0.8rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.badge-category {
		background: #e0f2fe;
		color: #0369a1;
	}

	.badge-assignee {
		background: #f3f4f6;
		color: #374151;
	}

	/* Priority badges */
	.badge-urgent {
		background: #fee2e2;
		color: #b91c1c;
	}

	.badge-high {
		background: #ffedd5;
		color: #c2410c;
	}

	.badge-normal {
		background: #f3f4f6;
		color: #374151;
	}

	.badge-low {
		background: #dbeafe;
		color: #1d4ed8;
	}

	/* Status badges */
	.badge-pending {
		background: #fef3c7;
		color: #92400e;
	}

	.badge-approved {
		background: #dcfce7;
		color: #166534;
	}

	.badge-rejected {
		background: #fee2e2;
		color: #b91c1c;
	}

	.badge-deferred {
		background: #f3e8ff;
		color: #6b21a8;
	}

	/* Action confirm */
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

	.action-buttons {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	/* Form */
	.field {
		margin-bottom: 1rem;
	}

	.form-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	/* History */
	.history-details {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		background: #fff;
	}

	.history-summary {
		padding: 1rem 1.5rem;
		cursor: pointer;
		font-weight: 600;
		color: #111827;
		list-style: none;
		user-select: none;
	}

	.history-summary::-webkit-details-marker {
		display: none;
	}

	.history-summary::before {
		content: '▶ ';
		font-size: 0.7rem;
		color: #6b7280;
	}

	details[open] .history-summary::before {
		content: '▼ ';
	}

	.history-list {
		padding: 0 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.history-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		border-top: 1px solid #f3f4f6;
		padding-top: 0.85rem;
	}

	.history-main {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.history-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.83rem;
	}

	.note {
		font-style: italic;
		max-width: 280px;
		text-align: right;
	}

	/* Utilities */
	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0;
	}

	.success-text {
		color: #166534;
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

		.loader-row {
			flex-direction: column;
			align-items: stretch;
		}

		.field-row {
			flex-direction: column;
		}

		.approval-header {
			flex-direction: column;
		}

		.approval-dates {
			align-items: flex-start;
		}

		.history-meta {
			align-items: flex-start;
		}

		.note {
			text-align: left;
		}
	}
</style>
