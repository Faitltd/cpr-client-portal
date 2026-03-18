<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { selectedDealId } from '$lib/stores/dealContext';

	interface DealOption {
		id: string;
		deal_name: string;
		stage: string;
		contact_name: string;
	}

	const dispatch = createEventDispatcher<{ select: { id: string; label: string } }>();

	let deals: DealOption[] = [];
	let loading = true;
	let error = '';
	let value = '';

	function dealLabel(d: DealOption) {
		const parts = [d.deal_name];
		if (d.contact_name) parts.push(`(${d.contact_name})`);
		parts.push(`— ${d.stage}`);
		return parts.join(' ');
	}

	function computeLabel(id: string) {
		const d = deals.find((x) => x.id === id);
		return d ? dealLabel(d) : id;
	}

	onMount(async () => {
		const stored = $selectedDealId;
		if (stored) value = stored;

		try {
			const res = await fetch('/api/admin/deals');
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load deals');
			deals = json.data ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load deals from CRM';
		} finally {
			loading = false;
		}

		if (value) {
			dispatch('select', { id: value, label: computeLabel(value) });
		}
	});

	function handleChange() {
		if (!value) return;
		selectedDealId.set(value);
		dispatch('select', { id: value, label: computeLabel(value) });
	}
</script>

<div class="deal-selector-card">
	{#if loading}
		<p class="ds-muted">Loading deals from CRM…</p>
	{:else if error}
		<p class="ds-error">{error}</p>
	{:else}
		<label class="ds-label" for="deal-selector">Deal</label>
		<select id="deal-selector" class="ds-select" bind:value on:change={handleChange}>
			<option value="">— Select a deal —</option>
			{#each deals as deal (deal.id)}
				<option value={deal.id}>{dealLabel(deal)}</option>
			{/each}
		</select>
	{/if}
</div>

<style>
	.deal-selector-card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1rem 1.25rem;
		background: #fff;
		margin-bottom: 1.25rem;
	}

	.ds-label {
		display: block;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
		margin-bottom: 0.4rem;
	}

	.ds-select {
		width: 100%;
		padding: 0.55rem 0.75rem;
		font-size: 0.92rem;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		background: #fff;
		color: #111827;
		cursor: pointer;
		appearance: auto;
	}

	.ds-select:focus {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
		border-color: #2563eb;
	}

	.ds-muted {
		margin: 0;
		color: #6b7280;
		font-size: 0.85rem;
	}

	.ds-error {
		margin: 0;
		color: #b91c1c;
		font-size: 0.85rem;
	}
</style>
