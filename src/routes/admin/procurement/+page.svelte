<script lang="ts">
	interface ProcurementItem {
		id: string;
		deal_id: string;
		item_name: string;
		category: string | null;
		status: string;
		vendor: string | null;
		cost: number | null;
		lead_time_days: number | null;
		expected_date: string | null;
		actual_date: string | null;
		notes: string | null;
		created_at: string;
		updated_at: string;
	}

	type ProcurementStatus =
		| 'needed'
		| 'approved'
		| 'ordered'
		| 'shipped'
		| 'delivered'
		| 'delayed'
		| 'damaged'
		| 'installed';
	type StatusFilter = 'all' | ProcurementStatus;

	const categoryOptions = ['material', 'fixture', 'appliance', 'custom'];
	const filterOptions: Array<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'needed', label: 'Needed' },
		{ value: 'approved', label: 'Approved' },
		{ value: 'ordered', label: 'Ordered' },
		{ value: 'shipped', label: 'Shipped' },
		{ value: 'delivered', label: 'Delivered' },
		{ value: 'delayed', label: 'Delayed' },
		{ value: 'damaged', label: 'Damaged' },
		{ value: 'installed', label: 'Installed' }
	];

	let dealIdInput = '';
	let loadedDealId = '';
	let items: ProcurementItem[] = [];
	let loading = false;
	let loadError = '';
	let actionError = '';
	let statusFilter: StatusFilter = 'all';
	let creating = false;
	let updatingId = '';

	let createForm = {
		item_name: '',
		category: 'material',
		vendor: '',
		cost: '',
		lead_time_days: '',
		expected_date: '',
		notes: ''
	};

	$: filteredItems =
		statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter);

	async function loadDeal() {
		const id = dealIdInput.trim();
		if (!id) return;
		loadedDealId = id;
		actionError = '';
		await fetchItems();
	}

	async function fetchItems() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/procurement?dealId=${encodeURIComponent(loadedDealId)}`);
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Failed to load');
			items = Array.isArray(json.data) ? json.data : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load procurement items';
			items = [];
		} finally {
			loading = false;
		}
	}

	async function createItem() {
		if (creating || !loadedDealId || !createForm.item_name.trim()) return;

		creating = true;
		actionError = '';

		const body = {
			deal_id: loadedDealId,
			item_name: createForm.item_name.trim(),
			category: createForm.category || null,
			status: 'needed',
			vendor: createForm.vendor.trim() || null,
			cost: createForm.cost !== '' ? Number(createForm.cost) : null,
			lead_time_days:
				createForm.lead_time_days !== '' ? Number(createForm.lead_time_days) : null,
			expected_date: createForm.expected_date || null,
			actual_date: null,
			notes: createForm.notes.trim() || null
		};

		try {
			const res = await fetch('/api/admin/procurement', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Create failed');
			const created = json.data as ProcurementItem | undefined;
			if (!created) throw new Error('Created item not returned');
			items = [created, ...items];
			createForm = {
				item_name: '',
				category: 'material',
				vendor: '',
				cost: '',
				lead_time_days: '',
				expected_date: '',
				notes: ''
			};
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to create procurement item';
		} finally {
			creating = false;
		}
	}

	async function updateStatus(id: string, status: ProcurementStatus) {
		updatingId = id;
		actionError = '';
		try {
			const res = await fetch(`/api/admin/procurement/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || json.message || 'Update failed');
			const updated = json.data as ProcurementItem | undefined;
			if (!updated) throw new Error('Updated item not returned');
			items = items.map((item) => (item.id === updated.id ? updated : item));
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to update procurement item';
		} finally {
			updatingId = '';
		}
	}

	function getActions(status: ProcurementStatus): Array<{ label: string; next: ProcurementStatus; tone: string }> {
		switch (status) {
			case 'needed':
				return [{ label: 'Approve', next: 'approved', tone: 'primary' }];
			case 'approved':
				return [{ label: 'Mark Ordered', next: 'ordered', tone: 'ordered' }];
			case 'ordered':
				return [
					{ label: 'Mark Shipped', next: 'shipped', tone: 'shipped' },
					{ label: 'Mark Delayed', next: 'delayed', tone: 'danger' }
				];
			case 'shipped':
				return [
					{ label: 'Mark Delivered', next: 'delivered', tone: 'success' },
					{ label: 'Mark Damaged', next: 'damaged', tone: 'danger' }
				];
			case 'delivered':
				return [{ label: 'Mark Installed', next: 'installed', tone: 'installed' }];
			case 'delayed':
				return [{ label: 'Mark Shipped', next: 'shipped', tone: 'shipped' }];
			case 'damaged':
				return [{ label: 'Reorder', next: 'ordered', tone: 'ordered' }];
			default:
				return [];
		}
	}

	function fmtCategory(value: string | null) {
		if (!value) return 'Uncategorized';
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	function fmtDate(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}

	function fmtCurrency(value: number | null) {
		if (value == null) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(value);
	}

	function statusColor(status: string) {
		if (status === 'needed') return '#9ca3af';
		if (status === 'approved') return '#3b82f6';
		if (status === 'ordered') return '#8b5cf6';
		if (status === 'shipped') return '#f59e0b';
		if (status === 'delivered') return '#10b981';
		if (status === 'delayed') return '#ef4444';
		if (status === 'damaged') return '#dc2626';
		if (status === 'installed') return '#059669';
		return '#9ca3af';
	}
</script>

<div class="container">
	<a class="back-link" href="/admin/clients">← Back to Clients</a>
	<h1>Procurement</h1>

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
		<details class="card create-card" open>
			<summary class="summary-toggle">Add Procurement Item</summary>
			<div class="form-grid">
				<div class="field">
					<label class="field-label" for="item-name">Item Name</label>
					<input id="item-name" class="input" type="text" bind:value={createForm.item_name} />
				</div>

				<div class="field">
					<label class="field-label" for="category">Category</label>
					<select id="category" class="input select" bind:value={createForm.category}>
						{#each categoryOptions as option}
							<option value={option}>{fmtCategory(option)}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label class="field-label" for="vendor">Vendor</label>
					<input id="vendor" class="input" type="text" bind:value={createForm.vendor} />
				</div>

				<div class="field">
					<label class="field-label" for="cost">Cost</label>
					<input id="cost" class="input" type="number" min="0" step="0.01" bind:value={createForm.cost} />
				</div>

				<div class="field">
					<label class="field-label" for="lead-time">Lead Time (days)</label>
					<input
						id="lead-time"
						class="input"
						type="number"
						min="0"
						step="1"
						bind:value={createForm.lead_time_days}
					/>
				</div>

				<div class="field">
					<label class="field-label" for="expected-date">Expected Date</label>
					<input id="expected-date" class="input" type="date" bind:value={createForm.expected_date} />
				</div>

				<div class="field field-full">
					<label class="field-label" for="notes">Notes</label>
					<textarea id="notes" class="textarea" rows="4" bind:value={createForm.notes}></textarea>
				</div>
			</div>

			<div class="create-actions">
				<button
					class="btn btn-primary"
					type="button"
					on:click={createItem}
					disabled={creating || !createForm.item_name.trim()}
				>
					{creating ? 'Adding…' : 'Add Item'}
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

			{#if filteredItems.length === 0}
				<div class="empty">No {statusFilter === 'all' ? '' : statusFilter} procurement items found for this deal.</div>
			{:else}
				<div class="item-list">
					{#each filteredItems as item (item.id)}
						<div class="card item-card" style={`border-left: 4px solid ${statusColor(item.status)};`}>
							<div class="item-header">
								<div class="item-title-block">
									<div class="badge-row">
										<span class={`badge status-${item.status}`}>{item.status}</span>
										<span class="badge badge-type">{fmtCategory(item.category)}</span>
									</div>
									<span class="item-title">{item.item_name}</span>
								</div>
								<div class="item-meta">
									<span class="muted">Created: {fmtDate(item.created_at)}</span>
									<span class="muted">Updated: {fmtDate(item.updated_at)}</span>
								</div>
							</div>

							<div class="detail-grid">
								<div class="detail">
									<span class="detail-label">Vendor</span>
									<span class="detail-value">{item.vendor || '—'}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Cost</span>
									<span class="detail-value">{fmtCurrency(item.cost)}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Lead Time</span>
									<span class="detail-value">
										{item.lead_time_days != null ? `${item.lead_time_days} days` : '—'}
									</span>
								</div>
								<div class="detail">
									<span class="detail-label">Expected Date</span>
									<span class="detail-value">{fmtDate(item.expected_date)}</span>
								</div>
								<div class="detail">
									<span class="detail-label">Actual Date</span>
									<span class="detail-value">{fmtDate(item.actual_date)}</span>
								</div>
							</div>

							{#if item.notes}
								<p class="item-notes">{item.notes}</p>
							{/if}

							{#if getActions(item.status as ProcurementStatus).length > 0}
								<div class="action-buttons">
									{#each getActions(item.status as ProcurementStatus) as action}
										<button
											class={`btn btn-action btn-${action.tone}`}
											type="button"
											on:click={() => updateStatus(item.id, action.next)}
											disabled={updatingId === item.id}
										>
											{updatingId === item.id ? 'Saving…' : action.label}
										</button>
									{/each}
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

	.select {
		background: #fff;
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

	.btn-ordered {
		background: #f5f3ff;
		border-color: #ddd6fe;
		color: #6d28d9;
	}

	.btn-ordered:hover:not(:disabled) {
		background: #ede9fe;
	}

	.btn-shipped {
		background: #fffbeb;
		border-color: #fde68a;
		color: #b45309;
	}

	.btn-shipped:hover:not(:disabled) {
		background: #fef3c7;
	}

	.btn-success {
		background: #ecfdf5;
		border-color: #a7f3d0;
		color: #166534;
	}

	.btn-success:hover:not(:disabled) {
		background: #d1fae5;
	}

	.btn-danger {
		background: #fef2f2;
		border-color: #fecaca;
		color: #b91c1c;
	}

	.btn-danger:hover:not(:disabled) {
		background: #fee2e2;
	}

	.btn-installed {
		background: #ecfdf5;
		border-color: #6ee7b7;
		color: #065f46;
	}

	.btn-installed:hover:not(:disabled) {
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

	.item-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.item-card {
		padding: 1.25rem;
	}

	.item-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.85rem;
	}

	.item-title-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.item-title {
		font-weight: 700;
		color: #111827;
		font-size: 1rem;
	}

	.item-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.83rem;
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

	.item-notes {
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

	.status-needed {
		background: #e5e7eb;
		color: #4b5563;
	}

	.status-approved {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-ordered {
		background: #ede9fe;
		color: #6d28d9;
	}

	.status-shipped {
		background: #fef3c7;
		color: #b45309;
	}

	.status-delivered {
		background: #d1fae5;
		color: #065f46;
	}

	.status-delayed {
		background: #fee2e2;
		color: #b91c1c;
	}

	.status-damaged {
		background: #fecaca;
		color: #991b1b;
	}

	.status-installed {
		background: #a7f3d0;
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
		.filter-row,
		.create-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.form-grid,
		.detail-grid {
			grid-template-columns: 1fr;
		}

		.item-header {
			flex-direction: column;
		}

		.item-meta {
			align-items: flex-start;
		}
	}
</style>
