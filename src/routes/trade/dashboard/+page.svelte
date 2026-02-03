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

	<div class="field-update">
		<a href="https://creatorapp.zohopublic.com/customprofessionalrenovation/field-updates/report-perma/All_Active_Deals/8KnyCKWyrWSDZDBE4KBGU2PsRwVqerdOjwxNR2zXhhwSfPUHzX4aDGECJySKyRW6VOQ5kbKr8rR2k1uvb470Cxzsj9FgWdWGxeTe" target="_blank" rel="noreferrer">
			Field Update
		</a>
	</div>

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
					<a class="detail-link" href="/trade/deal/{deal.id}">View Details</a>
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

	.field-update {
		margin-bottom: 1.5rem;
	}

	.field-update a {
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 1.1rem;
		border-radius: 999px;
		background: #111827;
		color: #fff;
		text-decoration: none;
		font-weight: 600;
	}

	.field-update a:hover {
		background: #1f2937;
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

	.detail-link {
		display: inline-block;
		margin-top: 0.75rem;
		color: #2563eb;
		text-decoration: none;
		font-weight: 600;
	}
</style>
