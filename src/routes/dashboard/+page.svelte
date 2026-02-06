<script lang="ts">
	import { onMount } from 'svelte';

	let projects: any[] = [];
	let invoices: any[] = [];
	let loading = true;
	let error = '';
	let invoiceError = '';
	let invoicesOpen = true;

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
						<h3>{project.Deal_Name || 'Untitled Project'}</h3>
						<p class="status">Status: {project.Stage || 'Unknown'}</p>
						<p class="date">Created: {new Date(project.Created_Time).toLocaleDateString()}</p>
						<p class="scope">Scope: {project.Refined_SOW || 'Not available'}</p>
						{#if project.External_Link}
							<a class="btn-secondary" href={project.External_Link} target="_blank" rel="noreferrer">
								Progress Photos
							</a>
						{/if}
						<a href="/project/{project.id}" class="btn-view">View Details</a>
					</div>
				{/each}
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
			{:else if invoices.length === 0}
				<p class="invoice-empty">No invoices found.</p>
			{:else}
				<div class="invoice-list">
					{#each invoices as invoice}
						<div class="invoice-card">
							<div>
								<h3>{invoice.invoice_number || invoice.invoice_id}</h3>
								<p class="invoice-meta">
									Status: {invoice.status || 'Unknown'} • Date:
									{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : '—'}
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
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.project-card {
		padding: 1.5rem;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: white;
	}

	.project-card h3 {
		margin-bottom: 1rem;
		color: #1a1a1a;
	}

	.status, .amount, .date {
		margin: 0.5rem 0;
		color: #666;
	}

	.scope {
		margin: 0.5rem 0;
		color: #666;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.btn-view {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: #0066cc;
		color: white;
		text-decoration: none;
		border-radius: 4px;
	}

	.btn-view:hover {
		background: #0052a3;
	}

	.invoices-section {
		margin-top: 3rem;
	}

	.section-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.2rem 0.6rem 0;
		border: none;
		background: transparent;
		font-size: 1.25rem;
		font-weight: 700;
		cursor: pointer;
		color: #111827;
	}

	.section-toggle:hover {
		color: #0f766e;
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
</style>
