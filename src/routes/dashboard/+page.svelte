<script lang="ts">
	import { onMount } from 'svelte';

	let projects: any[] = [];
	let invoices: any[] = [];
	let loading = true;
	let error = '';
	let invoiceError = '';
	let invoicesOpen = true;
	const getProgressPhotosLink = (deal: any) => {
		const candidates = [deal?.Progress_Photos, deal?.External_Link];
		for (const value of candidates) {
			if (!value) continue;
			if (typeof value === 'string') return value;
			if (typeof value === 'object') {
				const url =
					value.link_url ||
					value.link ||
					value.download_url ||
					value.url ||
					value.href ||
					'';
				if (url) return url;
			}
		}
		return '';
	};
	const formatInvoiceDate = (invoice: any) => {
		const raw =
			invoice?.invoice_date ??
			invoice?.date ??
			invoice?.created_time ??
			invoice?.created_date ??
			null;
		if (!raw) return '—';
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? String(raw) : parsed.toLocaleDateString();
	};
	$: invoiceTotals = invoices.reduce(
		(acc, invoice) => {
			const total = Number(invoice?.total || 0);
			const balance = Number(invoice?.balance || 0);
			if (!Number.isNaN(total)) acc.total += total;
			if (!Number.isNaN(balance)) acc.balance += balance;
			return acc;
		},
		{ total: 0, balance: 0 }
	);
	$: amountPaid = Math.max(0, invoiceTotals.total - invoiceTotals.balance);
	$: changeOrders = invoices.filter((invoice) => {
		const number = String(invoice?.invoice_number || invoice?.invoice_id || '').trim();
		return number.toUpperCase().startsWith('CO');
	});
	$: regularInvoices = invoices.filter((invoice) => !changeOrders.includes(invoice));

	onMount(async () => {
		try {
			const [projectsRes, invoicesRes] = await Promise.all([
				fetch('/api/projects'),
				fetch('/api/invoices')
			]);

			if (projectsRes.status === 401) {
				throw new Error('Please login again');
			}
			if (!projectsRes.ok) throw new Error('Failed to fetch projects');
			const projectsData = await projectsRes.json();
			projects = projectsData.data || [];

			if (invoicesRes.ok) {
				const invoicesData = await invoicesRes.json();
				invoices = invoicesData.data || [];
			} else if (invoicesRes.status !== 401) {
				invoiceError = 'Failed to fetch invoices';
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="dashboard">
	<header>
		<div class="header-row">
			<div>
				<h1>My Projects</h1>
				<p>View and manage your renovation projects</p>
			</div>
		</div>
	</header>

	{#if loading}
		<div class="loading">Loading your projects...</div>
	{:else if error}
		<div class="error">
			<p>Error: {error}</p>
			<a href="/auth/client">Please login again</a>
		</div>
	{:else if projects.length === 0}
		<div class="empty">
			<p>No projects found</p>
		</div>
	{:else}
		<section class="projects-section">
			<div class="projects-grid">
				{#each projects as project}
					<div class="project-card">
						<div class="project-info">
							<h3>{project.Deal_Name || 'Untitled Project'}</h3>
							<p class="status">Status: {project.Stage || 'Unknown'}</p>
							<p class="date">Created: {new Date(project.Created_Time).toLocaleDateString()}</p>
						</div>
						<div class="project-actions">
							{#if getProgressPhotosLink(project)}
								<a
									class="btn-view"
									href={getProgressPhotosLink(project)}
									target="_blank"
									rel="noreferrer"
								>
									Progress Photos
								</a>
							{/if}
							<a href="/project/{project.id}" class="btn-view">View Details</a>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section class="invoice-summary">
			<div class="summary-card">
				<p class="summary-label">Amount Paid</p>
				<p class="summary-value">${amountPaid.toLocaleString()}</p>
			</div>
			<div class="summary-card">
				<p class="summary-label">Remaining Balance</p>
				<p class="summary-value">${invoiceTotals.balance.toLocaleString()}</p>
			</div>
		</section>

		<section class="invoices-section">
			<button class="section-toggle" type="button" on:click={() => (invoicesOpen = !invoicesOpen)}>
				<span>Invoices</span>
				<span class="toggle-icon">{invoicesOpen ? '−' : '+'}</span>
			</button>
			{#if invoicesOpen}
			{#if invoiceError}
				<p class="invoice-error">{invoiceError}</p>
			{:else if regularInvoices.length === 0}
				<p class="invoice-empty">No invoices found.</p>
			{:else}
				<div class="invoice-list">
					{#each regularInvoices as invoice}
						<div class="invoice-card">
							<div>
								<h3>{invoice.invoice_number || invoice.invoice_id}</h3>
								<p class="invoice-meta">
									Status: {invoice.status || 'Unknown'} • Date:
									{formatInvoiceDate(invoice)}
								</p>
							</div>
							<div class="invoice-amounts">
								<p>Total: ${Number(invoice.total || 0).toLocaleString()}</p>
								<p>Balance: ${Number(invoice.balance || 0).toLocaleString()}</p>
								{#if invoice.payment_url}
									<a class="btn-view" href={invoice.payment_url} target="_blank" rel="noreferrer">
										Pay
									</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">
										View Invoice
									</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>

		<section class="change-orders">
			<div class="section-toggle section-static">Change Orders</div>
			{#if invoiceError}
				<p class="invoice-error">{invoiceError}</p>
			{:else if changeOrders.length === 0}
				<p class="invoice-empty">No change orders found.</p>
			{:else}
				<div class="invoice-list">
					{#each changeOrders as invoice}
						<div class="invoice-card">
							<div>
								<h3>{invoice.invoice_number || invoice.invoice_id}</h3>
								<p class="invoice-meta">
									Status: {invoice.status || 'Unknown'} • Date:
									{formatInvoiceDate(invoice)}
								</p>
							</div>
							<div class="invoice-amounts">
								<p>Total: ${Number(invoice.total || 0).toLocaleString()}</p>
								<p>Balance: ${Number(invoice.balance || 0).toLocaleString()}</p>
								{#if invoice.payment_url}
									<a class="btn-view" href={invoice.payment_url} target="_blank" rel="noreferrer">
										Pay
									</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">
										View Invoice
									</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.loading, .error, .empty {
		text-align: center;
		padding: 3rem;
		background: #f5f5f5;
		border-radius: 8px;
	}

	.error {
		color: #c00;
	}

	.projects-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.project-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.5rem;
		padding: 1rem 1.25rem;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: white;
	}

	.project-card h3 {
		margin-bottom: 0.5rem;
		color: #1a1a1a;
	}

	.status, .amount, .date {
		margin: 0.5rem 0;
		color: #666;
	}

	.project-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.btn-view {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
		line-height: 1.2;
	}

	.btn-view:hover {
		background: #0052a3;
	}

	.btn-secondary {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: #f5f5f5;
		color: #1a1a1a;
		text-decoration: none;
		border-radius: 4px;
		border: 1px solid #d0d0d0;
		line-height: 1.2;
	}

	.btn-secondary:hover {
		background: #e9e9e9;
	}

	.invoices-section {
		margin-top: 3rem;
	}

	.change-orders {
		margin-top: 2rem;
	}

	.invoice-summary {
		margin-top: 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
	}

	.summary-card {
		padding: 1rem 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #f8fafc;
	}

	.summary-label {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.summary-value {
		margin: 0.35rem 0 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}

	.section-toggle {
		width: 100%;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		background: #f8fafc;
		border-radius: 10px;
		font-size: 1.25rem;
		font-weight: 700;
		cursor: pointer;
		color: #111827;
	}

	.section-toggle:hover {
		color: #0f766e;
		background: #eef2f7;
	}

	.section-static {
		cursor: default;
	}

	.section-static:hover {
		color: #111827;
		background: #f8fafc;
	}

	.toggle-icon {
		font-size: 1.4rem;
		line-height: 1;
	}

	.invoice-list {
		display: grid;
		gap: 1rem;
	}

	.invoice-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: #fff;
	}

	.invoice-meta {
		color: #666;
		margin: 0.3rem 0 0;
	}

	.invoice-amounts {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.invoice-error {
		color: #c00;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1.5rem 1.25rem;
		}

		.header-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.project-card {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.project-actions {
			justify-content: flex-start;
		}

		.btn-view {
			margin-top: 0;
			width: 100%;
			text-align: center;
			min-height: 44px;
		}

		.btn-secondary {
			width: 100%;
			text-align: center;
			min-height: 44px;
		}

		.invoice-card {
			flex-direction: column;
			align-items: flex-start;
		}

		.invoice-amounts {
			justify-content: flex-start;
			width: 100%;
		}
	}
</style>
