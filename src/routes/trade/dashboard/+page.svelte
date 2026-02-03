<script lang="ts">
	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const formatAddress = (deal: any) => {
		const line1 = deal.Address || deal.Street || '';
		const line2 = deal.Address_Line_2 || '';
		const city = deal.City || '';
		const state = deal.State || '';
		const zip = deal.Zip_Code || '';
		const parts = [line1, line2].filter(Boolean);
		const cityStateZip = [city, state].filter(Boolean).join(', ');
		const tail = [cityStateZip, zip].filter(Boolean).join(' ');
		if (tail) parts.push(tail);
		return parts.join(', ');
	};
</script>

<div class="dashboard">
	<header>
		<h1>Trade Partner Dashboard</h1>
		<p>Welcome {data.tradePartner.name || data.tradePartner.email}</p>
	</header>

	{#if data.warning}
		<div class="card warning">{data.warning}</div>
	{:else if data.deals.length === 0}
		<div class="card">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		<div class="deals-grid">
			{#each data.deals as deal}
				<div class="card">
					<h3>{deal.Deal_Name || 'Untitled Deal'}</h3>
					<p class="meta">Stage: {deal.Stage || 'Unknown'}</p>
					<p class="meta">Amount: ${deal.Amount?.toLocaleString() || '0'}</p>
					{#if formatAddress(deal)}
						<p class="meta">Address: {formatAddress(deal)}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.warning {
		border-color: #f59e0b;
		background: #fffbeb;
		color: #92400e;
	}

	.deals-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1rem;
	}

	.meta {
		color: #6b7280;
		margin: 0.4rem 0 0;
	}
</style>
