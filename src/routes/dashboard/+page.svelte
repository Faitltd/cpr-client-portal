<script lang="ts">
	import { onMount } from 'svelte';

	interface ActivityItem {
		type: 'comm' | 'daily_log';
		date: string;
		summary: string | null;
		channel?: string;
		deal_id: string;
	}

	let projects: any[] = [];
	let invoices: any[] = [];
	let loading = true;
	let error = '';
	let invoiceError = '';
	let invoicesOpen = true;
	let pendingCount = 0;
	let pendingItems: any[] = [];
	let pendingLoading = true;
	let pendingError = '';
	let activityItems: ActivityItem[] = [];
	let activityLoading = true;
	let activityError = '';
	const getProgressPhotosLink = (deal: any) => {
		const dealId = String(deal?.id || '').trim();
		if (!dealId) return '';
		return `/project/${encodeURIComponent(dealId)}/photos`;
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

	const formatRelativeTime = (value: string | null) => {
		if (!value) return 'Recently';
		const timestamp = new Date(value).getTime();
		if (Number.isNaN(timestamp)) return value;

		const diffMs = Date.now() - timestamp;
		const minute = 60 * 1000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (diffMs < minute) return 'Just now';
		if (diffMs < hour) {
			const minutes = Math.floor(diffMs / minute);
			return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		}
		if (diffMs < day) {
			const hours = Math.floor(diffMs / hour);
			return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		}
		if (diffMs < day * 2) return 'Yesterday';
		if (diffMs < day * 7) {
			const days = Math.floor(diffMs / day);
			return `${days} day${days === 1 ? '' : 's'} ago`;
		}
		return new Date(value).toLocaleDateString();
	};

	onMount(async () => {
		fetch('/api/client/pending')
			.then(async (res) => {
				if (res.status === 401) return;
				if (!res.ok) throw new Error('Failed');
				const payload = await res.json();
				pendingCount = payload.count || 0;
				pendingItems = payload.data || [];
			})
			.catch((err) => {
				pendingError = err.message || 'Failed to load pending items';
			})
			.finally(() => {
				pendingLoading = false;
			});

		fetch('/api/client/activity')
			.then(async (res) => {
				if (res.status === 401) return;
				if (!res.ok) throw new Error('Failed');
				const payload = await res.json();
				activityItems = payload.data || [];
			})
			.catch((err) => {
				activityError = err.message || 'Failed to load recent activity';
			})
			.finally(() => {
				activityLoading = false;
			});

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

	<div class="pending-widget">
		<div class="pending-header">
			<span class="pending-title">Pending From You</span>
			{#if !pendingLoading && pendingCount > 0}
				<span class="pending-badge">{pendingCount}</span>
			{/if}
		</div>
		{#if pendingLoading}
			<p class="pending-muted">Loading...</p>
		{:else if pendingError}
			<p class="pending-muted">{pendingError}</p>
		{:else if pendingCount === 0}
			<p class="pending-muted">All caught up — nothing pending.</p>
		{:else}
			<ul class="pending-list">
				{#each pendingItems.slice(0, 3) as item (item.id)}
					<li class="pending-row">
						<span class="pending-item-title">{item.title}</span>
						<span class="pending-item-deal">{item.deal_name || ''}</span>
						{#if item.priority}
							<span class="pending-priority pending-priority-{item.priority}">{item.priority}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<a class="pending-view-all" href="/decisions">View All →</a>
		{/if}
	</div>

	<section class="activity-section">
		<div class="section-toggle section-static">Recent Activity</div>
		{#if activityLoading}
			<p class="activity-muted">Loading...</p>
		{:else if activityError}
			<p class="activity-muted">{activityError}</p>
		{:else if activityItems.length === 0}
			<p class="activity-muted">No recent activity.</p>
		{:else}
			<div class="activity-list">
				{#each activityItems as item, index (item.deal_id + item.date + item.type + index)}
					<div class="activity-item activity-item-{item.type}">
						<div class="activity-top">
							<div class="activity-labels">
								<span class="activity-type">{item.type === 'comm' ? 'Comm' : 'Update'}</span>
								{#if item.type === 'comm' && item.channel}
									<span class="activity-channel">{item.channel}</span>
								{/if}
							</div>
							<span class="activity-time">{formatRelativeTime(item.date)}</span>
						</div>
						<p class="activity-summary">
							{item.summary || (item.type === 'comm' ? 'Communication logged.' : 'Daily update submitted.')}
						</p>
					</div>
				{/each}
			</div>
		{/if}
	</section>

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
							<span class="stage-badge">{project.Stage || 'Unknown'}</span>
							<h3>{project.Deal_Name || 'Untitled Project'}</h3>
							<p class="project-meta">Next milestone: {project.Stage || 'Unknown'}</p>
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

	.status, .date {
		margin: 0.5rem 0;
		color: #666;
	}

	.project-meta {
		margin: 0.5rem 0;
		color: #666;
	}

	.stage-badge {
		display: inline-flex;
		align-items: center;
		background: #e0f2fe;
		color: #0369a1;
		border-radius: 999px;
		padding: 0.25rem 0.65rem;
		font-size: 0.8rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
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

	.pending-widget {
		border: 1px solid #fcd34d;
		border-left: 4px solid #f59e0b;
		background: #fffbeb;
		border-radius: 8px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 2rem;
	}

	.pending-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
	}

	.pending-title {
		font-weight: 700;
		font-size: 1rem;
		color: #92400e;
	}

	.pending-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #f59e0b;
		color: #fff;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		padding: 0.1rem 0.5rem;
		min-width: 1.4rem;
	}

	.pending-muted {
		margin: 0;
		color: #92400e;
		font-size: 0.9rem;
		opacity: 0.75;
	}

	.pending-list {
		list-style: none;
		margin: 0 0 0.85rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.pending-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.pending-item-title {
		font-weight: 600;
		color: #111827;
		font-size: 0.92rem;
	}

	.pending-item-deal {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.pending-priority {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.pending-priority-urgent {
		background: #dc2626;
		color: #fff;
	}

	.pending-priority-high {
		background: #f59e0b;
		color: #1c1917;
	}

	.pending-priority-normal {
		background: #e5e7eb;
		color: #374151;
	}

	.pending-priority-low {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.pending-view-all {
		display: inline-block;
		color: #b45309;
		font-weight: 700;
		font-size: 0.9rem;
		text-decoration: none;
	}

	.pending-view-all:hover {
		text-decoration: underline;
	}

	.activity-section {
		margin-bottom: 2rem;
	}

	.activity-list {
		display: grid;
		gap: 0.9rem;
		margin-top: 1rem;
	}

	.activity-item {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.25rem 0 0.25rem 1rem;
		border-left: 3px solid transparent;
	}

	.activity-item-comm {
		border-left-color: #0066cc;
	}

	.activity-item-daily_log {
		border-left-color: #10b981;
	}

	.activity-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.activity-labels {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.activity-type,
	.activity-channel {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.activity-type {
		background: #f3f4f6;
		color: #111827;
	}

	.activity-channel {
		background: #e5e7eb;
		color: #374151;
		text-transform: capitalize;
	}

	.activity-time,
	.activity-muted {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.activity-muted {
		margin: 1rem 0 0;
	}

	.activity-summary {
		margin: 0;
		color: #111827;
		line-height: 1.5;
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

		.activity-item {
			padding-left: 0.75rem;
		}

		.activity-top {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.4rem;
		}
	}
</style>
