<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	interface ScopeDefinition {
		deal_id: string;
		project_type: string;
		status: string;
		updated_at?: string;
		created_at?: string;
	}

	interface DealOption {
		id: string;
		deal_name: string;
		stage: string;
		contact_name: string;
	}

	let dealIdInput = '';
	let scopes: ScopeDefinition[] = [];
	let loading = false;
	let loadError = '';

	// Deal dropdown
	let deals: DealOption[] = [];
	let dealsLoading = false;
	let dealsError = '';
	let selectedDealId = '';
	let manualExpanded = false;

	const STATUS_COLORS: Record<string, string> = {
		draft: '#9ca3af',
		reviewed: '#3b82f6',
		approved: '#059669',
		generated: '#7c3aed'
	};

	onMount(async () => {
		await Promise.all([fetchScopes(), fetchDeals()]);
	});

	async function fetchScopes() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/admin/scope');
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load');
			scopes = json.data ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load scope definitions';
		} finally {
			loading = false;
		}
	}

	async function fetchDeals() {
		dealsLoading = true;
		dealsError = '';
		try {
			const res = await fetch('/api/admin/deals');
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load deals');
			deals = json.data ?? [];
		} catch (err) {
			dealsError = err instanceof Error ? err.message : 'Failed to load deals from CRM';
		} finally {
			dealsLoading = false;
		}
	}

	function openFromDropdown() {
		if (!selectedDealId) return;
		goto(`/admin/scope/${selectedDealId}`);
	}

	function openEditor() {
		const id = dealIdInput.trim();
		if (!id) return;
		goto(`/admin/scope/${id}`);
	}

	function fmtDate(value: string | undefined) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}
</script>

<div class="container">
	<h1>Scope Definitions</h1>

	<!-- Deal dropdown -->
	<div class="card nav-card">
		<label class="field-label" for="deal-select">Select a Deal</label>
		{#if dealsLoading}
			<p class="muted">Loading deals from CRM…</p>
		{:else if dealsError}
			<p class="error-text">{dealsError}</p>
		{:else}
			<div class="input-row">
				<select id="deal-select" class="input deal-select" bind:value={selectedDealId}>
					<option value="">— Select a deal —</option>
					{#each deals as deal (deal.id)}
						<option value={deal.id}>{deal.deal_name}{deal.contact_name ? ` (${deal.contact_name})` : ''} — {deal.stage}</option>
					{/each}
				</select>
				<button class="btn btn-primary" on:click={openFromDropdown} disabled={!selectedDealId}>
					Open Scope Builder
				</button>
			</div>
		{/if}

		<button class="manual-toggle" on:click={() => (manualExpanded = !manualExpanded)}>
			{manualExpanded ? '▾' : '▸'} Or enter Deal ID manually
		</button>

		{#if manualExpanded}
			<div class="input-row manual-row">
				<input
					id="deal-id-input"
					class="input"
					type="text"
					placeholder="Enter Zoho Deal ID"
					bind:value={dealIdInput}
					on:keydown={(e) => e.key === 'Enter' && openEditor()}
				/>
				<button class="btn btn-primary" on:click={openEditor} disabled={!dealIdInput.trim()}>
					Open Editor
				</button>
			</div>
		{/if}
	</div>

	<!-- Scope list -->
	<section class="section">
		<h2>All Scope Definitions</h2>

		{#if loading}
			<p class="muted">Loading…</p>
		{:else if loadError}
			<p class="error-text">{loadError}</p>
		{:else if scopes.length === 0}
			<div class="empty">
				No scope definitions yet. Enter a deal ID above to create one.
			</div>
		{:else}
			<div class="scope-table">
				<div class="table-header">
					<span>Deal ID</span>
					<span>Project Type</span>
					<span>Status</span>
					<span>Updated</span>
				</div>
				{#each scopes as scope (scope.deal_id)}
					<div class="table-row">
						<a class="deal-link" href="/admin/scope/{scope.deal_id}">{scope.deal_id}</a>
						<span class="type-text">{scope.project_type?.replace(/_/g, ' ') ?? '—'}</span>
						<span
							class="status-badge"
							style="background:{STATUS_COLORS[scope.status] ?? '#9ca3af'};color:#fff;"
						>
							{scope.status ?? 'draft'}
						</span>
						<span class="muted">{fmtDate(scope.updated_at ?? scope.created_at)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.container {
		max-width: 1100px;
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
		margin-bottom: 1.5rem;
	}

	.nav-card {
		max-width: 700px;
	}

	.field-label {
		display: block;
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		margin-bottom: 0.5rem;
	}

	.input-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
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
		padding: 0.5rem 1.25rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		color: #1a1a1a;
		min-height: 44px;
		cursor: pointer;
		font-size: 0.93rem;
		white-space: nowrap;
		text-decoration: none;
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

	/* Table */
	.scope-table {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		background: #fff;
		overflow: hidden;
	}

	.table-header {
		display: grid;
		grid-template-columns: 2fr 1.5fr 1fr 1fr;
		gap: 1rem;
		padding: 0.75rem 1.25rem;
		background: #f9fafb;
		border-bottom: 1px solid #e0e0e0;
		font-size: 0.8rem;
		font-weight: 700;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.table-row {
		display: grid;
		grid-template-columns: 2fr 1.5fr 1fr 1fr;
		gap: 1rem;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid #f3f4f6;
		align-items: center;
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.table-row:hover {
		background: #f9fafb;
	}

	.deal-link {
		color: #0066cc;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.93rem;
	}

	.deal-link:hover {
		text-decoration: underline;
	}

	.type-text {
		font-size: 0.9rem;
		color: #374151;
		text-transform: capitalize;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
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

	.deal-select {
		appearance: auto;
		cursor: pointer;
	}

	.manual-toggle {
		display: block;
		margin-top: 0.75rem;
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0;
	}
	.manual-toggle:hover { color: #374151; }

	.manual-row {
		margin-top: 0.5rem;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.nav-card {
			max-width: none;
		}

		.input-row {
			flex-direction: column;
			align-items: stretch;
		}

		.table-header {
			display: none;
		}

		.table-row {
			grid-template-columns: 1fr;
			gap: 0.4rem;
			padding: 1rem 1.25rem;
		}
	}
</style>
