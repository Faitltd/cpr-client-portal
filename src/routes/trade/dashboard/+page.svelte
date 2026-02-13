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

	type DesignFile = { name: string; url?: string; attachmentId?: string };

	const safeDecode = (value: string) => {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	};

	const normalizeDesignFiles = (value: any): DesignFile[] => {
		if (!value) return [];

		const toItem = (item: any): DesignFile | null => {
			if (!item) return null;
			if (typeof item === 'string') {
				const name = item.split('/').pop() || 'Design file';
				return { name, url: item };
			}
			if (typeof item === 'object') {
				const attachmentId =
					item.fields_attachment_id ||
					item.fieldsAttachmentId ||
					item.attachment_id ||
					item.attachmentId ||
					item.file_id ||
					item.fileId ||
					item.id ||
					item.ID ||
					'';
				const url =
					item.link_url ||
					item.link ||
					item.download_url ||
					item.url ||
					item.File_Url ||
					item.File_URL ||
					item.file_url ||
					item.fileUrl ||
					item.href ||
					'';
				const name =
					item.file_name ||
					item.File_Name ||
					item.name ||
					item.filename ||
					item.fileName ||
					item.display_name ||
					safeDecode(String(url).split('/').pop() || '') ||
					'Design file';
				if (!url && !attachmentId) return null;
				return { name, url: url || undefined, attachmentId: attachmentId || undefined };
			}
			return null;
		};

		if (Array.isArray(value)) {
			return value.map(toItem).filter(Boolean) as DesignFile[];
		}

		const single = toItem(value);
		return single ? [single] : [];
	};

	const getDesignLink = (file: DesignFile) => {
		if (file.url) return file.url;
		if (!file.attachmentId || !selectedDeal?.id) return '';
		const params = new URLSearchParams();
		if (file.name) params.set('fileName', file.name);
		const suffix = params.toString() ? `?${params.toString()}` : '';
		return `/api/trade/deals/${selectedDeal.id}/fields-attachment/${file.attachmentId}${suffix}`;
	};

	$: designFiles = normalizeDesignFiles(selectedDeal?.File_Upload);
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

	const fieldUpdateUrl =
		'https://creatorapp.zohopublic.com/customprofessionalrenovation/field-updates/form-embed/Active_Deals/mpPsAZEnCtDY0M6J5FR8n86Enzj2dDBkemTjDBSwJRWqpDHy8r39rP8M6euMFdez0OFMTO0eZhEhaKYEmTnC0ZY7vyYfx4T4EM4a';

	const getProgressPhotosLink = (deal: any) => {
		const value = deal?.Progress_Photos;
		if (!value) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'object') {
			return (
				value.link_url ||
				value.link ||
				value.download_url ||
				value.url ||
				value.href ||
				''
			);
		}
		return '';
	};
</script>

<div class="dashboard">
	<header>
		<h1>Trade Partner Dashboard</h1>
		<p>Welcome {tradePartner.name || tradePartner.email}</p>
	</header>

	<div class="field-update card">
		<a class="field-update-button" href={fieldUpdateUrl} target="_blank" rel="noreferrer">
			Open Field Update Form
		</a>
		<p class="field-update-hint">
			Opens in a new tab so camera/microphone permissions work reliably.
		</p>
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
						<h4>Workdrive External Link</h4>
						{#if selectedDeal.External_Link}
							<p>
								<a class="file-link" href={selectedDeal.External_Link} target="_blank" rel="noreferrer">
									Open Workdrive
								</a>
							</p>
						{:else}
							<p>Not available</p>
						{/if}
					</div>
					<div class="notes">
						<h4>Progress Photos</h4>
						{#if getProgressPhotosLink(selectedDeal)}
							<p>
								<a
									class="file-link"
									href={getProgressPhotosLink(selectedDeal)}
									target="_blank"
									rel="noreferrer"
								>
									Open Progress Photos
								</a>
							</p>
						{:else}
							<p>Not available</p>
						{/if}
					</div>
					<div class="notes">
						<h4>Designs</h4>
						{#if designFiles.length > 0}
							<ul class="file-list">
								{#each designFiles as file}
									{#if getDesignLink(file)}
										<li>
											<a class="file-link" href={getDesignLink(file)} target="_blank" rel="noreferrer">
												{file.name}
											</a>
										</li>
									{/if}
								{/each}
							</ul>
						{:else}
							<p>Not available</p>
						{/if}
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
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.field-update-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		text-decoration: none;
		font-weight: 700;
		border-radius: 10px;
		padding: 0.85rem 1.25rem;
		min-height: 44px;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
	}

	.field-update-button:hover {
		background: #0052a3;
	}

	.field-update-hint {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
		line-height: 1.35;
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
		min-height: 44px;
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

	.file-list {
		margin: 0;
		padding-left: 1.1rem;
	}

	.file-list li {
		margin: 0.3rem 0;
	}

	.file-link {
		color: #1d4ed8;
		text-decoration: underline;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	.file-link:hover {
		color: #1e40af;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1.5rem 1.25rem;
		}

		.field-update-button {
			width: 100%;
		}

		.card {
			padding: 1.25rem;
		}

		.details-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
