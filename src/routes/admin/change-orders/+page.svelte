<script lang="ts">
	interface ChangeOrder {
		id: string;
		deal_id: string;
		title: string;
		description: string | null;
		estimated_amount: number | null;
		approved_amount: number | null;
		status: string;
		identified_by: string | null;
		identified_at: string;
		approved_at: string | null;
		billed_at: string | null;
		created_at: string;
	}

	type ChangeOrderStatus = 'identified' | 'scoped' | 'sent' | 'approved' | 'billed' | 'rejected';
	type StatusFilter = 'all' | ChangeOrderStatus;

	const filterOptions: Array<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'identified', label: 'Identified' },
		{ value: 'scoped', label: 'Scoped' },
		{ value: 'sent', label: 'Sent' },
		{ value: 'approved', label: 'Approved' },
		{ value: 'billed', label: 'Billed' },
		{ value: 'rejected', label: 'Rejected' }
	];

	let dealIdInput = '';
	let loadedDealId = '';
	let orders: ChangeOrder[] = [];
	let loading = false;
	let loadError = '';
	let actionError = '';
	let statusFilter: StatusFilter = 'all';
	let creating = false;
	let updatingId = '';
	let approvalAmounts: Record<string, string> = {};

	let createForm: {
		title: string;
		description: string;
		estimated_amount: string | number;
		identified_by: string;
	} = {
		title: '',
		description: '',
		estimated_amount: '',
		identified_by: ''
	};

	$: filteredOrders =
		statusFilter === 'all' ? orders : orders.filter((order) => order.status === statusFilter);

	$: summary = {
		totalEstimated: orders.reduce((sum, order) => sum + (order.estimated_amount ?? 0), 0),
		totalApproved: orders
			.filter((order) => order.status === 'approved' || order.status === 'billed')
			.reduce((sum, order) => sum + (order.approved_amount ?? 0), 0),
		totalBilled: orders
			.filter((order) => order.status === 'billed')
			.reduce((sum, order) => sum + (order.approved_amount ?? 0), 0),
		unbilledCount: orders.filter((order) => order.status === 'approved').length,
		revenueAtRisk: orders
			.filter((order) => order.status === 'identified' || order.status === 'scoped')
			.reduce((sum, order) => sum + (order.estimated_amount ?? 0), 0)
	};

	async function loadDeal() {
		const id = dealIdInput.trim();
		if (!id) return;
		loadedDealId = id;
		actionError = '';
		await fetchOrders();
	}

	async function fetchOrders() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/change-orders?dealId=${encodeURIComponent(loadedDealId)}`);
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Failed to load');
			orders = Array.isArray(json.data) ? json.data : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load change orders';
			orders = [];
		} finally {
			loading = false;
		}
	}

	async function createOrder() {
		if (creating || !loadedDealId || !createForm.title.trim()) return;

		creating = true;
		actionError = '';

		const body = {
			deal_id: loadedDealId,
			title: createForm.title.trim(),
			description: createForm.description.trim() || null,
			estimated_amount:
				createForm.estimated_amount !== '' ? Number(createForm.estimated_amount) : null,
			approved_amount: null,
			status: 'identified',
			identified_by: createForm.identified_by.trim() || null
		};

		try {
			const res = await fetch('/api/admin/change-orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Create failed');
			const created = json.data as ChangeOrder | undefined;
			if (!created) throw new Error('Created order not returned');
			orders = [created, ...orders];
			createForm = {
				title: '',
				description: '',
				estimated_amount: '',
				identified_by: ''
			};
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to create change order';
		} finally {
			creating = false;
		}
	}

	async function updateOrder(id: string, updates: Record<string, unknown>) {
		updatingId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/change-orders/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Update failed');
			const updated = json.data as ChangeOrder | undefined;
			if (!updated) throw new Error('Updated order not returned');
			orders = orders.map((order) => (order.id === updated.id ? updated : order));
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to update change order';
		} finally {
			updatingId = '';
		}
	}

	async function approveOrder(order: ChangeOrder) {
		const raw = approvalAmountValue(order).trim();
		if (!raw) {
			actionError = 'Approved amount is required';
			return;
		}

		const approvedAmount = Number(raw);
		if (Number.isNaN(approvedAmount)) {
			actionError = 'Approved amount must be a number';
			return;
		}

		await updateOrder(order.id, {
			status: 'approved',
			approved_amount: approvedAmount,
			approved_at: new Date().toISOString()
		});
	}

	function approvalAmountValue(order: ChangeOrder) {
		if (order.id in approvalAmounts) return approvalAmounts[order.id];
		if (order.approved_amount != null) return String(order.approved_amount);
		if (order.estimated_amount != null) return String(order.estimated_amount);
		return '';
	}

	function setApprovalAmount(id: string, value: string) {
		approvalAmounts = { ...approvalAmounts, [id]: value };
	}

	function fmtCurrency(value: number | null) {
		if (value == null) return '—';
		return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}

	function statusColor(status: string) {
		if (status === 'identified') return '#f59e0b';
		if (status === 'scoped') return '#8b5cf6';
		if (status === 'sent') return '#3b82f6';
		if (status === 'approved') return '#10b981';
		if (status === 'billed') return '#059669';
		if (status === 'rejected') return '#ef4444';
		return '#9ca3af';
	}
	
</script>

<div class="container">
	<a class="back-link" href="/admin/clients">← Back to Clients</a>
	<h1>Change Orders</h1>

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
			<button class="btn btn-primary" type="button" on:click={loadDeal} disabled={!dealIdInput.trim()}>
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
		<div class="summary-grid">
			<div class="card summary-card">
				<span class="summary-label">Total Estimated</span>
				<span class="summary-value">{fmtCurrency(summary.totalEstimated)}</span>
			</div>
			<div class="card summary-card">
				<span class="summary-label">Total Approved</span>
				<span class="summary-value">{fmtCurrency(summary.totalApproved)}</span>
			</div>
			<div class="card summary-card">
				<span class="summary-label">Unbilled</span>
				<span class="summary-value">{summary.unbilledCount}</span>
			</div>
			<div class="card summary-card">
				<span class="summary-label">Revenue at Risk</span>
				<span class="summary-value">{fmtCurrency(summary.revenueAtRisk)}</span>
			</div>
		</div>

		<details class="card create-card" open>
			<summary class="summary-toggle">Add Change Order</summary>
			<div class="form-grid">
				<div class="field">
					<label class="field-label" for="title">Title</label>
					<input id="title" class="input" type="text" bind:value={createForm.title} />
				</div>

				<div class="field">
					<label class="field-label" for="identified-by">Identified By</label>
					<input id="identified-by" class="input" type="text" bind:value={createForm.identified_by} />
				</div>

				<div class="field">
					<label class="field-label" for="estimated-amount">Estimated Amount</label>
					<input
						id="estimated-amount"
						class="input"
						type="number"
						min="0"
						step="0.01"
						bind:value={createForm.estimated_amount}
					/>
				</div>

				<div class="field field-full">
					<label class="field-label" for="description">Description</label>
					<textarea id="description" class="textarea" rows="4" bind:value={createForm.description}></textarea>
				</div>
			</div>

			<div class="create-actions">
				<button
					class="btn btn-primary"
					type="button"
					on:click={createOrder}
					disabled={creating || !createForm.title.trim()}
				>
					{creating ? 'Adding…' : 'Add Change Order'}
				</button>
			</div>
		</details>

		<div class="card filter-card">
			<div class="filter-row">
				{#each filterOptions as option}
					<button
						class="btn"
						class:btn-primary={statusFilter === option.value}
						type="button"
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

			{#if filteredOrders.length === 0}
				<div class="empty">No {statusFilter === 'all' ? '' : statusFilter} change orders found for this deal.</div>
			{:else}
				<div class="order-list">
					{#each filteredOrders as order (order.id)}
						<div class="card order-card" style={`border-left: 4px solid ${statusColor(order.status)};`}>
							<div class="order-header">
								<div class="order-title-block">
									<div class="badge-row">
										<span class={`badge status-${order.status}`}>{order.status}</span>
									</div>
									<span class="order-title">{order.title}</span>
								</div>
								<div class="order-meta">
									<span class="muted">Identified: {fmtDateTime(order.identified_at)}</span>
									<span class="muted">By: {order.identified_by || '—'}</span>
								</div>
							</div>

							{#if order.description}
								<p class="order-description">{order.description}</p>
							{/if}

							<div class="detail-grid">
								<div class="detail">
									<span class="detail-label">Estimated Amount</span>
									<span class="detail-value">{fmtCurrency(order.estimated_amount)}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Approved Amount</span>
									<span class="detail-value">{fmtCurrency(order.approved_amount)}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Approved Date</span>
									<span class="detail-value">{fmtDateTime(order.approved_at)}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Billed Date</span>
									<span class="detail-value">{fmtDateTime(order.billed_at)}</span>
								</div>
							</div>

							{#if order.status === 'identified'}
								<div class="action-buttons">
									<button
										class="btn btn-scoped"
										type="button"
										on:click={() => updateOrder(order.id, { status: 'scoped' })}
										disabled={updatingId === order.id}
									>
										{updatingId === order.id ? 'Saving…' : 'Mark Scoped'}
									</button>
								</div>
							{:else if order.status === 'scoped'}
								<div class="action-buttons">
									<button
										class="btn btn-sent"
										type="button"
										on:click={() => updateOrder(order.id, { status: 'sent' })}
										disabled={updatingId === order.id}
									>
										{updatingId === order.id ? 'Saving…' : 'Mark Sent'}
									</button>
								</div>
							{:else if order.status === 'sent'}
								<div class="approve-block">
									<div class="field approve-field">
										<label class="field-label" for={"approved-amount-" + order.id}>Approved Amount</label>
										<input
											id={"approved-amount-" + order.id}
											class="input"
											type="number"
											min="0"
											step="0.01"
											value={approvalAmountValue(order)}
											on:input={(e) =>
												setApprovalAmount(order.id, (e.currentTarget as HTMLInputElement).value)}
										/>
									</div>
									<div class="action-buttons">
										<button
											class="btn btn-approve"
											type="button"
											on:click={() => approveOrder(order)}
											disabled={updatingId === order.id}
										>
											{updatingId === order.id ? 'Saving…' : 'Approve'}
										</button>
										<button
											class="btn btn-reject"
											type="button"
											on:click={() => updateOrder(order.id, { status: 'rejected' })}
											disabled={updatingId === order.id}
										>
											{updatingId === order.id ? 'Saving…' : 'Reject'}
										</button>
									</div>
								</div>
							{:else if order.status === 'approved'}
								<div class="action-buttons">
									<button
										class="btn btn-billed"
										type="button"
										on:click={() =>
											updateOrder(order.id, {
												status: 'billed',
												billed_at: new Date().toISOString()
											})}
										disabled={updatingId === order.id}
									>
										{updatingId === order.id ? 'Saving…' : 'Mark Billed'}
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
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

	.back-link {
		display: inline-flex;
		align-items: center;
		color: #6b7280;
		text-decoration: none;
		font-size: 0.88rem;
		margin-bottom: 0.75rem;
	}

	.back-link:hover {
		color: #0066cc;
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

	.loader-card,
	.create-card,
	.filter-card {
		margin-bottom: 2rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.summary-card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.summary-label {
		color: #6b7280;
		font-size: 0.82rem;
	}

	.summary-value {
		color: #111827;
		font-size: 1.2rem;
		font-weight: 700;
	}

	.loader-row,
	.filter-row,
	.action-buttons,
	.badge-row,
	.create-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field-full {
		grid-column: 1 / -1;
	}

	.field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		margin-bottom: 0.25rem;
		display: block;
	}

	.input,
	.textarea {
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font-size: 0.93rem;
		min-height: 44px;
		width: 100%;
		box-sizing: border-box;
	}

	.textarea {
		border-radius: 8px;
		min-height: 110px;
		resize: vertical;
		padding-top: 0.75rem;
		font-family: inherit;
	}

	.input:focus,
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

	.btn-scoped {
		background: #f5f3ff;
		border-color: #ddd6fe;
		color: #6d28d9;
	}

	.btn-scoped:hover:not(:disabled) {
		background: #ede9fe;
	}

	.btn-sent {
		background: #eff6ff;
		border-color: #bfdbfe;
		color: #1d4ed8;
	}

	.btn-sent:hover:not(:disabled) {
		background: #dbeafe;
	}

	.btn-approve {
		background: #ecfdf5;
		border-color: #a7f3d0;
		color: #166534;
	}

	.btn-approve:hover:not(:disabled) {
		background: #d1fae5;
	}

	.btn-reject {
		background: #fef2f2;
		border-color: #fecaca;
		color: #b91c1c;
	}

	.btn-reject:hover:not(:disabled) {
		background: #fee2e2;
	}

	.btn-billed {
		background: #ecfdf5;
		border-color: #6ee7b7;
		color: #065f46;
	}

	.btn-billed:hover:not(:disabled) {
		background: #d1fae5;
	}

	.summary-toggle {
		font-weight: 700;
		color: #111827;
		cursor: pointer;
		list-style: none;
	}

	.summary-toggle::-webkit-details-marker {
		display: none;
	}

	.summary-toggle::before {
		content: '▶ ';
		font-size: 0.65rem;
		color: #6b7280;
	}

	details[open] > .summary-toggle::before {
		content: '▼ ';
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-top: 1rem;
	}

	.order-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.order-card {
		padding: 1.25rem;
	}

	.order-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.85rem;
	}

	.order-title-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.order-title {
		font-weight: 700;
		color: #111827;
		font-size: 1rem;
	}

	.order-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.83rem;
	}

	.order-description {
		color: #4b5563;
		font-size: 0.9rem;
		margin: 0 0 0.85rem;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem 1rem;
		margin-bottom: 0.85rem;
	}

	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.detail-label {
		color: #6b7280;
		font-size: 0.8rem;
	}

	.detail-value {
		color: #111827;
		font-size: 0.92rem;
	}

	.approve-block {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.approve-field {
		max-width: 240px;
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

	.status-identified {
		background: #fef3c7;
		color: #b45309;
	}

	.status-scoped {
		background: #ede9fe;
		color: #6d28d9;
	}

	.status-sent {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-approved {
		background: #d1fae5;
		color: #065f46;
	}

	.status-billed {
		background: #a7f3d0;
		color: #065f46;
	}

	.status-rejected {
		background: #fee2e2;
		color: #b91c1c;
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

		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.form-grid,
		.detail-grid {
			grid-template-columns: 1fr;
		}

		.loader-row,
		.filter-row,
		.create-actions,
		.action-buttons {
			flex-direction: column;
			align-items: stretch;
		}

		.order-header {
			flex-direction: column;
		}

		.order-meta {
			align-items: flex-start;
		}
	}
</style>
