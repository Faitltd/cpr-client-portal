<script lang="ts">
	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const tradePartner = data?.tradePartner || { email: '' };
	const deals = Array.isArray(data?.deals) ? data.deals : [];
	let selectedDealId = deals[0]?.id || '';
	$: selectedDeal = deals.find((deal) => deal.id === selectedDealId);
	$: selectedDeal && console.log('Selected Deal:', selectedDeal);
	const getDealLabel = (deal: any) => {
		return (
			deal?.Deal_Name ||
			deal?.Potential_Name ||
			deal?.Name ||
			deal?.name ||
			deal?.Subject ||
			deal?.Full_Name ||
			deal?.Display_Name ||
			deal?.display_name ||
			(deal?.id ? `Deal ${String(deal.id).slice(-6)}` : 'Untitled Deal')
		);
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

	const getMapsUrl = (deal: any) => {
		const address = formatAddress(deal);
		if (!address) return '';
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
	};
</script>

<div class="dashboard">
	<header>
		<h1>Trade Partner Dashboard</h1>
		<p>Welcome {tradePartner.name || tradePartner.email}</p>
	</header>

	<div class="field-update">
		<iframe
			title="Field Update"
			height="600"
			width="100%"
			frameborder="0"
			scrolling="auto"
			allowtransparency="true"
			src="https://creatorapp.zohopublic.com/customprofessionalrenovation/field-updates/form-embed/Active_Deals/mpPsAZEnCtDY0M6J5FR8n86Enzj2dDBkemTjDBSwJRWqpDHy8r39rP8M6euMFdez0OFMTO0eZhEhaKYEmTnC0ZY7vyYfx4T4EM4a"
		></iframe>
	</div>

	{#if data?.warning}
		<div class="card warning">{data.warning}</div>
	{:else if deals.length === 0}
		<div class="card">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		<div class="trade-selector card">
			<label for="trade-deal">Select Deal</label>
			<select id="trade-deal" bind:value={selectedDealId}>
				{#each deals as deal}
					<option value={deal.id}>
						{getDealLabel(deal)}
					</option>
				{/each}
			</select>
		</div>

		{#if selectedDeal}
			<div class="card deal-details">
				<h3>{getDealLabel(selectedDeal)}</h3>
				<div class="details-grid">
					<div>
						<h4>Address</h4>
						{#if formatAddress(selectedDeal)}
							<p>
								<a
									class="address-link"
									href={getMapsUrl(selectedDeal)}
									target="_blank"
									rel="noreferrer"
								>
									{formatAddress(selectedDeal)}
								</a>
							</p>
						{:else}
							<p>Not available</p>
						{/if}
					</div>
					<div>
						<h4>Garage Code</h4>
						<p>{selectedDeal.Garage_Code || 'Not available'}</p>
					</div>
					<div>
						<h4>WiFi</h4>
						<p>{selectedDeal.WiFi || 'Not available'}</p>
					</div>
					<div class="notes">
						<h4>Scope</h4>
						<p>{selectedDeal.Refined_SOW || 'Not available'}</p>
					</div>
					<div class="notes">
						<h4>Notes</h4>
						<p>{selectedDeal.Notes1 || 'Not available'}</p>
					</div>
				</div>
			</div>
		{/if}
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

	.field-update iframe {
		border: none;
		width: 100%;
		min-height: 600px;
	}

	.warning {
		border-color: #f59e0b;
		background: #fffbeb;
		color: #92400e;
	}

	.trade-selector {
		margin-bottom: 1.5rem;
		display: grid;
		gap: 0.5rem;
	}

	select {
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 1rem;
		width: 100%;
	}

	.deal-details h3 {
		margin-top: 0;
	}

	.details-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.details-grid h4 {
		margin: 0 0 0.35rem;
	}

	.details-grid p {
		margin: 0;
		color: #374151;
	}

	.address-link {
		color: #1d4ed8;
		text-decoration: underline;
	}

	.address-link:hover {
		color: #1e40af;
	}

	.notes {
		grid-column: 1 / -1;
	}
</style>
