<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

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

	type FieldUpdate = {
		id: string;
		createdAt: string | null;
		updatedAt: string | null;
		type: string | null;
		body: string | null;
		photos: Array<{ name: string; url: string }>;
	};

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

	const formatUpdateTimestamp = (value: string | null) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return String(value);
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	let fieldUpdates: FieldUpdate[] = [];
	let fieldUpdatesLoading = false;
	let fieldUpdatesError = '';
	let lastFieldUpdatesDealId = '';
	let fieldUpdatesController: AbortController | null = null;

	const loadFieldUpdates = async (dealId: string) => {
		if (!dealId) return;
		fieldUpdatesController?.abort();
		fieldUpdatesController = new AbortController();
		fieldUpdatesLoading = true;
		fieldUpdatesError = '';
		let didTimeout = false;
		const timeoutId = setTimeout(() => {
			didTimeout = true;
			fieldUpdatesController?.abort();
		}, 15000);

		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(dealId)}/field-updates`, {
				signal: fieldUpdatesController.signal
			});
			if (res.status === 401) throw new Error('Please login again');
			if (!res.ok) {
				let serverMessage = '';
				try {
					const payload = await res.json().catch(() => ({}));
					serverMessage = String(payload?.message || '').trim();
				} catch {
					// ignore
				}
				if (!serverMessage) {
					serverMessage = (await res.text().catch(() => '')).trim();
				}
				throw new Error(
					serverMessage
						? `${serverMessage} (${res.status})`
						: `Failed to fetch field updates (${res.status})`
				);
			}
			const payload = await res.json().catch(() => ({}));
			fieldUpdates = Array.isArray(payload?.data) ? payload.data : [];
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				if (didTimeout) {
					fieldUpdatesError = 'Field updates request timed out. Please retry.';
					fieldUpdates = [];
				}
				return;
			}
			fieldUpdatesError = err instanceof Error ? err.message : 'Failed to fetch field updates';
			fieldUpdates = [];
		} finally {
			clearTimeout(timeoutId);
			fieldUpdatesLoading = false;
		}
	};

	$: if (browser && selectedDealId && selectedDealId !== lastFieldUpdatesDealId) {
		lastFieldUpdatesDealId = selectedDealId;
		loadFieldUpdates(selectedDealId);
	}

	onDestroy(() => fieldUpdatesController?.abort());
</script>

<div class="dashboard">
	<header>
		<h1>Trade Partner Dashboard</h1>
		<p>Welcome {tradePartner.name || tradePartner.email}</p>
	</header>

	<div class="field-update card">
		<div class="field-update-actions">
			<a class="field-update-button" href={fieldUpdateUrl} target="_blank" rel="noreferrer">
				Open Field Update Form
			</a>
			<a class="field-update-secondary" href="/trade/photos">Progress Photos</a>
		</div>
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

			<div class="card field-updates-card">
				<div class="field-updates-header">
					<h3>Field Updates</h3>
				</div>

				{#if fieldUpdatesLoading}
					<p class="muted">Loading field updates...</p>
				{:else if fieldUpdatesError}
					<div class="field-updates-error">
						<p class="error-text">{fieldUpdatesError}</p>
						<button class="retry" type="button" on:click={() => loadFieldUpdates(selectedDealId)}>
							Retry
						</button>
					</div>
				{:else if fieldUpdates.length === 0}
					<p class="muted">No field updates submitted for this deal yet.</p>
				{:else}
					<div class="updates">
						{#each fieldUpdates as update (update.id)}
							<article class="update">
								<div class="update-meta">
									{#if update.type}
										<span class="badge">{update.type}</span>
									{/if}
									<span class="update-date">
										{formatUpdateTimestamp(update.createdAt || update.updatedAt)}
									</span>
								</div>

								{#if update.body}
									<p class="update-body">{update.body}</p>
								{/if}

								{#if update.photos?.length}
									<div class="update-photos">
										{#each update.photos as photo (photo.url)}
											<a class="photo" href={photo.url} target="_blank" rel="noreferrer">
												<img src={photo.url} alt={photo.name} loading="lazy" />
											</a>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
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

	.field-update-actions {
		display: flex;
		flex-wrap: wrap;
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

	.field-update-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #f9fafb;
		color: #111827;
		text-decoration: none;
		font-weight: 700;
		border-radius: 10px;
		padding: 0.85rem 1.25rem;
		min-height: 44px;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
		border: 1px solid #d1d5db;
	}

	.field-update-secondary:hover {
		background: #f3f4f6;
		border-color: #cbd5e1;
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

	.field-updates-card {
		margin-top: 1.5rem;
	}

	.field-updates-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.field-updates-header h3 {
		margin: 0;
	}

	.muted {
		margin: 0;
		color: #6b7280;
	}

	.error-text {
		margin: 0;
		color: #b91c1c;
	}

	.field-updates-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.retry {
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
		border-radius: 10px;
		padding: 0.55rem 0.85rem;
		font-weight: 800;
		min-height: 40px;
		cursor: pointer;
	}

	.retry:hover {
		background: #f3f4f6;
	}

	.updates {
		display: grid;
		gap: 1rem;
	}

	.update {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 1rem 1.1rem;
		background: #fff;
	}

	.update-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: #111827;
		color: #fff;
		font-size: 0.8rem;
		font-weight: 800;
	}

	.update-date {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.update-body {
		margin: 0 0 0.8rem;
		color: #111827;
		line-height: 1.45;
		white-space: pre-wrap;
	}

	.update-photos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.photo {
		display: block;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.photo img {
		display: block;
		width: 100%;
		height: 120px;
		object-fit: cover;
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

		.field-updates-header {
			flex-direction: column;
			align-items: stretch;
		}

		.field-update-button {
			width: 100%;
		}

		.field-update-actions a {
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
