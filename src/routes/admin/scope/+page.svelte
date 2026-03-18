<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DealSelector from '$lib/components/DealSelector.svelte';

	function openScope(id: string) {
		if (id) goto(`/admin/scope/${id}`);
	}

	interface ScopeDefinition {
		deal_id: string;
		project_type: string;
		status: string;
		updated_at?: string;
		created_at?: string;
	}

	let scopes: ScopeDefinition[] = [];
	let loading = false;
	let loadError = '';

	const STATUS_COLORS: Record<string, string> = {
		draft: '#9ca3af',
		reviewed: '#3b82f6',
		approved: '#059669',
		generated: '#7c3aed'
	};

	onMount(() => fetchScopes());

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

	function fmtDate(value: string | undefined) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
	}
</script>

<div class="container">
	<h1>Scope Definitions</h1>

	<DealSelector on:select={(e) => openScope(e.detail.id)} />

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
