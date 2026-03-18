<script lang="ts">
	import { onMount } from 'svelte';

	interface ActivityItem {
		type: 'comm' | 'daily_log';
		date: string;
		summary: string | null;
		channel?: string;
		deal_id: string;
	}

	interface EmailPref {
		id: string;
		deal_id: string;
		client_email: string;
		frequency: string;
		enabled: boolean;
	}

	interface EmailTimelineItem {
		id: string;
		date: string;
		direction: 'inbound' | 'outbound';
		subject: string;
		summary: string | null;
		from_name: string | null;
		from_email: string | null;
		to: string[];
	}

	let projects: any[] = [];
	let invoices: any[] = [];
	let loading = true;
	let error = '';
	let invoiceError = '';
	let activityOpen = true;
	let projectsOpen = true;
	let financialOpen = true;
	let invoicesOpen = true;
	let changeOrdersOpen = true;
	let emailUpdatesOpen = true;
	let decisionsOpen = false;
	let accountOpen = false;

	// Photos / Project Overview
	let photosOpen = true;
	let overviewOpen = true;
	let projectDetail: any = null;
	let projectNotes: any[] = [];

	// Contracts / Documents / Access Info
	let contracts: any[] = [];
	let contractsLoading = true;
	let contractError = '';
	let contractsOpen = true;
	let documents: any[] = [];
	let documentsLoading = true;
	let documentsOpen = true;
	let accessProjectId = '';
	let wifiInput = '';
	let doorCodeInput = '';
	let accessMessage = '';
	let accessError = '';
	let accessUpdating = false;
	let accessOpen = true;

	const submitAccessInfo = async () => {
		accessMessage = '';
		accessError = '';
		const wifi = wifiInput.trim();
		const doorCode = doorCodeInput.trim();
		if (!wifi || !doorCode) { accessError = 'WiFi and door code are required.'; return; }
		if (wifi.length > 200) { accessError = 'WiFi must be 200 characters or less.'; return; }
		if (doorCode.length > 100) { accessError = 'Door code must be 100 characters or less.'; return; }
		accessUpdating = true;
		try {
			const res = await fetch(`/api/project/${accessProjectId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ wifi, garageCode: doorCode })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) { accessError = payload?.message || 'Failed to update.'; return; }
			accessMessage = payload?.message || 'Access info updated.';
		} catch { accessError = 'Failed to update access info.'; }
		finally { accessUpdating = false; }
	};

	// Account — password reset
	let pwNew = '';
	let pwConfirm = '';
	let pwMessage = '';
	let pwLoading = false;

	const submitPassword = async () => {
		pwMessage = '';
		if (pwNew.length < 8) { pwMessage = 'Password must be at least 8 characters.'; return; }
		if (pwNew !== pwConfirm) { pwMessage = 'Passwords do not match.'; return; }
		pwLoading = true;
		try {
			const res = await fetch('/account/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: pwNew })
			});
			const payload = await res.json().catch(() => ({}));
			if (res.ok) { pwMessage = payload.message || 'Password updated.'; pwNew = ''; pwConfirm = ''; }
			else { pwMessage = payload.message || 'Unable to update password.'; }
		} catch { pwMessage = 'Unable to update password.'; }
		finally { pwLoading = false; }
	};
	let activityItems: ActivityItem[] = [];
	let activityLoading = true;
	let activityError = '';
	let emailPrefs: EmailPref[] = [];
	let emailPrefsLoading = true;
	let emailTimeline: EmailTimelineItem[] = [];
	let emailTimelineLoading = true;
	let emailTimelineError = '';
	const getErrorMessage = (payload: any, fallback: string) =>
		payload?.error || payload?.message || fallback;
	const readJson = async (res: Response) => res.json().catch(() => ({}));
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

	const updateEmailFrequency = async (pref: EmailPref, frequency: string) => {
		try {
			const res = await fetch('/api/client/email-preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deal_id: pref.deal_id, frequency })
			});
			if (!res.ok) {
				const payload = await readJson(res);
				throw new Error(getErrorMessage(payload, 'Failed to update'));
			}
			pref.frequency = frequency;
			emailPrefs = [...emailPrefs];
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to update email preference');
		}
	};

	onMount(async () => {
		fetch('/api/client/email-preferences')
			.then(async (res) => {
				if (res.status === 401) return;
				const payload = await readJson(res);
				if (res.ok) emailPrefs = payload.data || [];
			})
			.catch(() => {})
			.finally(() => { emailPrefsLoading = false; });

		fetch('/api/client/emails')
			.then(async (res) => {
				if (res.status === 401) return;
				const payload = await readJson(res);
				if (!res.ok) throw new Error(getErrorMessage(payload, 'Failed to load emails'));
				emailTimeline = payload.data || [];
			})
			.catch((err) => {
				emailTimelineError = err.message || 'Failed to load emails';
			})
			.finally(() => {
				emailTimelineLoading = false;
			});

		fetch('/api/client/activity')
			.then(async (res) => {
				if (res.status === 401) return;
				const payload = await readJson(res);
				if (!res.ok) throw new Error(getErrorMessage(payload, 'Failed to load recent activity'));
				activityItems = payload.data || [];
			})
			.catch((err) => {
				activityError = err.message || 'Failed to load recent activity';
			})
			.finally(() => {
				activityLoading = false;
			});

		try {
			const [projectsRes, invoicesRes, contractsRes] = await Promise.all([
				fetch('/api/projects'),
				fetch('/api/invoices'),
				fetch('/api/sign/requests')
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

			if (contractsRes.ok) {
				const contractsData = await contractsRes.json();
				contracts = contractsData.data || [];
			} else if (contractsRes.status !== 401) {
				contractError = 'Failed to fetch contracts';
			}
			contractsLoading = false;

			// Fetch project detail (documents + access info) using first project
			if (projects.length > 0) {
				const pid = projects[0].id;
				accessProjectId = pid;
				const detailRes = await fetch(`/api/project/${pid}`);
				if (detailRes.ok) {
					const detail = await detailRes.json();
					projectDetail = detail.deal || null;
					projectNotes = detail.notes || [];
					wifiInput = detail.deal?.WiFi || '';
					doorCodeInput = detail.deal?.Garage_Code || '';
					documents = detail.documents || [];
				}
			}
			documentsLoading = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	});
</script>

<div class="dashboard">
	<header class="page-header">
		<h1>My Projects</h1>
		<p class="page-subtitle">View and manage your renovation projects</p>
	</header>

	<!-- Activity Section -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (activityOpen = !activityOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="8"/><path d="M10 6v4l3 2"/></svg>
				Recent Activity
			</span>
			<span class="toggle-icon">{activityOpen ? '−' : '+'}</span>
		</button>
		{#if activityOpen}
			{#if activityLoading}
				<p class="muted-text">Loading...</p>
			{:else if activityError}
				<p class="muted-text">{activityError}</p>
			{:else if activityItems.length === 0}
				<p class="muted-text">No recent activity.</p>
			{:else}
				<div class="activity-list">
					{#each activityItems as item, index (item.deal_id + item.date + item.type + index)}
						<div class="activity-item activity-item-{item.type}">
							<div class="activity-top">
								<div class="activity-labels">
									<span class="badge badge-muted">{item.type === 'comm' ? 'Comm' : 'Update'}</span>
									{#if item.type === 'comm' && item.channel}
										<span class="badge badge-channel">{item.channel}</span>
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
		{/if}
	</section>

	{#if loading}
		<div class="state-card">Loading your projects...</div>
	{:else if error}
		<div class="state-card state-error">
			<p>Error: {error}</p>
			<a href="/auth/client" class="btn-primary">Please login again</a>
		</div>
	{:else if projects.length === 0}
		<div class="state-card">No projects found</div>
	{:else}
		<!-- Projects -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (projectsOpen = !projectsOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="16" height="16" rx="3"/><path d="M2 8h16"/><path d="M8 8v10"/></svg>
					Projects
				</span>
				<span class="toggle-icon">{projectsOpen ? '−' : '+'}</span>
			</button>
			{#if projectsOpen}
			{#each projects as project}
				<div class="project-card">
					<div class="project-top">
						<span class="stage-badge">{project.Stage || 'Unknown'}</span>
						<span class="project-date">{new Date(project.Created_Time).toLocaleDateString()}</span>
					</div>
					<h3 class="project-name">{project.Deal_Name || 'Untitled Project'}</h3>
					<p class="project-meta">Next milestone: {project.Stage || 'Unknown'}</p>
				</div>
			{/each}
			{/if}
		</section>

		<!-- Photos -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (photosOpen = !photosOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="2"/><path d="M18 14l-4-4-3 3-2-2-5 5"/></svg>
					Progress Photos
				</span>
				<span class="toggle-icon">{photosOpen ? '−' : '+'}</span>
			</button>
			{#if photosOpen}
				{@const photoLinks = projects.filter(p => getProgressPhotosLink(p))}
				{#if photoLinks.length === 0}
					<p class="muted-text">No photos available.</p>
				{:else}
					<div class="doc-list">
						{#each photoLinks as project}
							{@const link = getProgressPhotosLink(project)}
							<div class="doc-item">
								<span class="doc-link-label">{project.Deal_Name || 'Project'}</span>
								<a
									href={link}
									class="btn-secondary btn-sm"
									target={link.startsWith('http') ? '_blank' : undefined}
									rel={link.startsWith('http') ? 'noreferrer' : undefined}
								>View Photos</a>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>

		<!-- Financial Summary -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (financialOpen = !financialOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v2M10 16v2M2 10h2M16 10h2"/><circle cx="10" cy="10" r="5"/></svg>
					Financial Summary
				</span>
				<span class="toggle-icon">{financialOpen ? '−' : '+'}</span>
			</button>
			{#if financialOpen}
			<div class="summary-grid">
				<div class="summary-card">
					<span class="summary-label">Amount Paid</span>
					<span class="summary-value">${amountPaid.toLocaleString()}</span>
				</div>
				<div class="summary-card">
					<span class="summary-label">Remaining Balance</span>
					<span class="summary-value">${invoiceTotals.balance.toLocaleString()}</span>
				</div>
			</div>
			{/if}
		</section>

		<!-- Invoices -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (invoicesOpen = !invoicesOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 6h6M7 10h6M7 14h4"/></svg>
					Invoices
				</span>
				<span class="toggle-icon">{invoicesOpen ? '−' : '+'}</span>
			</button>
			{#if invoicesOpen}
			{#if invoiceError}
				<p class="muted-text error-text">{invoiceError}</p>
			{:else if regularInvoices.length === 0}
				<p class="muted-text">No invoices found.</p>
			{:else}
				<div class="card-list">
					{#each regularInvoices as invoice}
						<div class="invoice-card">
							<div class="invoice-info">
								<h3 class="invoice-number">{invoice.invoice_number || invoice.invoice_id}</h3>
								<div class="invoice-meta">
									<span class="badge badge-muted">{invoice.status || 'Unknown'}</span>
									<span class="meta-text">{formatInvoiceDate(invoice)}</span>
								</div>
							</div>
							<div class="invoice-amounts">
								<div class="amount-row">
									<span class="amount-label">Total</span>
									<span class="amount-value">${Number(invoice.total || 0).toLocaleString()}</span>
								</div>
								<div class="amount-row">
									<span class="amount-label">Balance</span>
									<span class="amount-value">${Number(invoice.balance || 0).toLocaleString()}</span>
								</div>
							</div>
							<div class="invoice-actions">
								{#if invoice.payment_url}
									<a class="btn-primary" href={invoice.payment_url} target="_blank" rel="noreferrer">Pay Now</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">View Invoice</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>

		<!-- Change Orders -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (changeOrdersOpen = !changeOrdersOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l6 6-10 10H2v-6L12 2z"/><path d="M9 5l6 6"/></svg>
					Change Orders
				</span>
				<span class="toggle-icon">{changeOrdersOpen ? '−' : '+'}</span>
			</button>
			{#if changeOrdersOpen}
			{#if invoiceError}
				<p class="muted-text error-text">{invoiceError}</p>
			{:else if changeOrders.length === 0}
				<p class="muted-text">No change orders found.</p>
			{:else}
				<div class="card-list">
					{#each changeOrders as invoice}
						<div class="invoice-card">
							<div class="invoice-info">
								<h3 class="invoice-number">{invoice.invoice_number || invoice.invoice_id}</h3>
								<div class="invoice-meta">
									<span class="badge badge-muted">{invoice.status || 'Unknown'}</span>
									<span class="meta-text">{formatInvoiceDate(invoice)}</span>
								</div>
							</div>
							<div class="invoice-amounts">
								<div class="amount-row">
									<span class="amount-label">Total</span>
									<span class="amount-value">${Number(invoice.total || 0).toLocaleString()}</span>
								</div>
								<div class="amount-row">
									<span class="amount-label">Balance</span>
									<span class="amount-value">${Number(invoice.balance || 0).toLocaleString()}</span>
								</div>
							</div>
							<div class="invoice-actions">
								{#if invoice.payment_url}
									<a class="btn-primary" href={invoice.payment_url} target="_blank" rel="noreferrer">Pay Now</a>
								{/if}
								{#if invoice.invoice_url}
									<a class="btn-secondary" href={invoice.invoice_url} target="_blank" rel="noreferrer">View Invoice</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>

		<!-- Email Updates Timeline -->
		<section class="section">
			<button class="section-header" type="button" on:click={() => (emailUpdatesOpen = !emailUpdatesOpen)}>
				<span class="section-header-left">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 4l8 6 8-6"/></svg>
					Email Updates
				</span>
				<span class="toggle-icon">{emailUpdatesOpen ? '−' : '+'}</span>
			</button>
			{#if emailUpdatesOpen}
			{#if emailTimelineLoading}
				<p class="muted-text">Loading...</p>
			{:else if emailTimelineError}
				<p class="muted-text error-text">{emailTimelineError}</p>
			{:else if emailTimeline.length === 0}
				<p class="muted-text">No email updates yet.</p>
			{:else}
				<div class="email-timeline">
					{#each emailTimeline as email (email.id)}
						<div class="email-item email-{email.direction}">
							<div class="email-item-top">
								<div class="email-item-labels">
									<span class="badge {email.direction === 'inbound' ? 'badge-inbound' : 'badge-outbound'}">
										{email.direction === 'inbound' ? 'Received' : 'Sent'}
									</span>
									{#if email.from_name}
										<span class="email-from">{email.from_name}</span>
									{/if}
								</div>
								<span class="email-time">{formatRelativeTime(email.date)}</span>
							</div>
							<p class="email-subject">{email.subject}</p>
							{#if email.summary}
								<p class="email-summary">{email.summary}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Email frequency preferences -->
			{#if !emailPrefsLoading && emailPrefs.length > 0}
				<div class="email-prefs-sub">
					<span class="email-prefs-label">Update frequency</span>
					{#each emailPrefs as pref (pref.id)}
						<div class="email-pref-card">
							<div class="email-pref-info">
								<span class="email-pref-deal">Project {pref.deal_id.slice(-6)}</span>
								<span class="email-pref-email">{pref.client_email}</span>
							</div>
							<select
								value={pref.frequency}
								on:change={(e) => updateEmailFrequency(pref, e.currentTarget.value)}
							>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="none">None</option>
							</select>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</section>
{/if}

	<!-- Contracts -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (contractsOpen = !contractsOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="1" width="14" height="18" rx="2"/><path d="M7 5h6M7 9h6M7 13h4"/></svg>
				Contracts
			</span>
			<span class="toggle-icon">{contractsOpen ? '−' : '+'}</span>
		</button>
		{#if contractsOpen}
			{#if contractsLoading}
				<p class="muted-text">Loading...</p>
			{:else if contractError}
				<p class="muted-text error-text">{contractError}</p>
			{:else if contracts.length === 0}
				<p class="muted-text">No contracts found.</p>
			{:else}
				<div class="card-list">
					{#each contracts as contract}
						<div class="contract-card">
							<div class="contract-info">
								<h3 class="contract-name">{contract.name}</h3>
								<span class="badge badge-muted">{contract.status || 'Unknown'}</span>
							</div>
							<div class="contract-actions">
								{#if contract.can_sign}
									<a class="btn-primary" href={`/contracts/${contract.id}/sign`} target="_blank" rel="noopener">Sign</a>
								{/if}
								{#if /complete|signed/i.test(contract.status || '')}
									<a class="btn-secondary" href={`/api/sign/requests/${contract.id}/pdf`} target="_blank" rel="noopener">View PDF</a>
								{:else if contract.view_url}
									<a class="btn-secondary" href={`/contracts/${contract.id}/view?url=${encodeURIComponent(contract.view_url)}`} target="_blank" rel="noopener">View</a>
								{:else}
									<a class="btn-secondary" href={`/contracts/${contract.id}/view`} target="_blank" rel="noopener">View</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	<!-- Documents -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (documentsOpen = !documentsOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h8l5 5v11a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v5h5"/></svg>
				Documents
			</span>
			<span class="toggle-icon">{documentsOpen ? '−' : '+'}</span>
		</button>
		{#if documentsOpen}
			{#if documentsLoading}
				<p class="muted-text">Loading...</p>
			{:else if documents.length === 0}
				<p class="muted-text">No documents found.</p>
			{:else}
				<div class="doc-list">
					{#each documents as doc}
						<div class="doc-item">
							<a href={`/api/project/${accessProjectId}/documents/${doc.id}?fileName=${encodeURIComponent(doc.File_Name)}`} target="_blank" class="doc-link">{doc.File_Name}</a>
							<span class="meta-text">{new Date(doc.Created_Time).toLocaleDateString()}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	<!-- Access Info -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (accessOpen = !accessOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="11" r="4"/><path d="M12 7l6 6M15 7h3v3"/></svg>
				Update Access Info
			</span>
			<span class="toggle-icon">{accessOpen ? '−' : '+'}</span>
		</button>
		{#if accessOpen}
			<div class="access-body">
				<label class="access-label" for="dash-wifi">WiFi</label>
				<input id="dash-wifi" class="access-input" type="text" bind:value={wifiInput} placeholder="WiFi details" />
				<label class="access-label" for="dash-door">Door Code</label>
				<input id="dash-door" class="access-input" type="text" bind:value={doorCodeInput} placeholder="Door code" />
				<button class="access-btn" type="button" on:click={submitAccessInfo} disabled={accessUpdating || !accessProjectId}>
					{accessUpdating ? 'Saving…' : 'Save Access Info'}
				</button>
				{#if accessMessage}<p class="access-msg-ok">{accessMessage}</p>{/if}
				{#if accessError}<p class="access-msg-err">{accessError}</p>{/if}
			</div>
		{/if}
	</section>

	<!-- Project Overview -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (overviewOpen = !overviewOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h14M3 8h10M3 12h12M3 16h8"/></svg>
				Project Overview
			</span>
			<span class="toggle-icon">{overviewOpen ? '−' : '+'}</span>
		</button>
		{#if overviewOpen}
			{#if !projectDetail}
				<p class="muted-text">Loading...</p>
			{:else}
				<div class="overview-grid">
					<div class="overview-item">
						<span class="overview-label">Closing Date</span>
						<span class="overview-value">{projectDetail.Closing_Date ? new Date(projectDetail.Closing_Date).toLocaleDateString() : 'TBD'}</span>
					</div>
					<div class="overview-item">
						<span class="overview-label">Project Manager</span>
						<span class="overview-value">{projectDetail.Owner?.name || 'Not assigned'}</span>
					</div>
					{#if projectDetail.Refined_SOW}
						<div class="overview-item overview-item-full">
							<span class="overview-label">Scope</span>
							<p class="overview-text">{projectDetail.Refined_SOW}</p>
						</div>
					{/if}
					{#if projectDetail.Description}
						<div class="overview-item overview-item-full">
							<span class="overview-label">Description</span>
							<p class="overview-text">{projectDetail.Description}</p>
						</div>
					{/if}
				</div>
				{#if projectNotes.length > 0}
					<div class="notes-list">
						<span class="overview-label">Project Timeline</span>
						{#each projectNotes as note}
							<div class="note-card">
								<div class="note-meta">
									<span class="note-date">{new Date(note.Created_Time).toLocaleDateString()}</span>
									{#if note.Owner?.name}<span class="note-author">— {note.Owner.name}</span>{/if}
								</div>
								<p class="note-content">{note.Note_Content}</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		{/if}
	</section>

	<!-- Decisions -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (decisionsOpen = !decisionsOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v6l4 2"/><circle cx="10" cy="10" r="8"/></svg>
				Decisions
			</span>
			<span class="toggle-icon">{decisionsOpen ? '−' : '+'}</span>
		</button>
		{#if decisionsOpen}
			<p class="muted-text coming-soon">Coming soon.</p>
		{/if}
	</section>

	<!-- Account -->
	<section class="section">
		<button class="section-header" type="button" on:click={() => (accountOpen = !accountOpen)}>
			<span class="section-header-left">
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="7" r="4"/><path d="M3 18c0-3.3 3.1-6 7-6s7 2.7 7 6"/></svg>
				Account
			</span>
			<span class="toggle-icon">{accountOpen ? '−' : '+'}</span>
		</button>
		{#if accountOpen}
			<div class="account-body">
				<h3 class="account-subhead">Set Password</h3>
				<label class="account-label" for="pw-new">New Password</label>
				<input id="pw-new" class="account-input" type="password" bind:value={pwNew} />
				<label class="account-label" for="pw-confirm">Confirm Password</label>
				<input id="pw-confirm" class="account-input" type="password" bind:value={pwConfirm} />
				<button
					class="account-btn"
					type="button"
					on:click={submitPassword}
					disabled={pwLoading || !pwNew || !pwConfirm}
				>
					{pwLoading ? 'Updating…' : 'Update Password'}
				</button>
				{#if pwMessage}
					<p class="account-message">{pwMessage}</p>
				{/if}
				<div class="account-divider"></div>
				<a class="account-logout" href="/api/logout?next=/">Log out</a>
			</div>
		{/if}
	</section>
</div>

<style>
	/* ── Mobile-first base ────────────────────────────── */
	.dashboard {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.page-header h1 {
		font-size: 1.35rem;
		font-weight: 800;
		color: #111827;
		margin: 0;
	}

	.page-subtitle {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	/* ── Sections ─────────────────────────────────────── */
	.section {
		margin-bottom: 1.25rem;
	}

	.section-header {
		width: 100%;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0.85rem;
		border: 1px solid #e5e7eb;
		background: #f8fafc;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		color: #111827;
		-webkit-tap-highlight-color: transparent;
	}

	.section-header:hover {
		background: #eef2f7;
	}

	.section-header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.section-header-left svg {
		flex-shrink: 0;
		color: #6b7280;
	}

	.toggle-icon {
		font-size: 1.25rem;
		line-height: 1;
		color: #9ca3af;
	}

	/* ── State cards ──────────────────────────────────── */
	.state-card {
		text-align: center;
		padding: 2rem 1rem;
		background: #f5f5f5;
		border-radius: 12px;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.state-error {
		color: #dc2626;
		background: #fef2f2;
	}

	/* ── Muted text ──────────────────────────────────── */
	.muted-text {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0.75rem 0 0;
		padding-left: 0.25rem;
	}

	.error-text {
		color: #dc2626;
	}

	/* ── Activity ─────────────────────────────────────── */
	.activity-list {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.activity-item {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem 0.75rem;
		border-left: 3px solid transparent;
		border-radius: 0 8px 8px 0;
		background: #fafafa;
	}

	.activity-item-comm {
		border-left-color: #3b82f6;
	}

	.activity-item-daily_log {
		border-left-color: #10b981;
	}

	.activity-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.activity-labels {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.activity-time {
		color: #9ca3af;
		font-size: 0.75rem;
	}

	.activity-summary {
		margin: 0;
		color: #374151;
		font-size: 0.85rem;
		line-height: 1.45;
	}

	/* ── Badges ───────────────────────────────────────── */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.badge-muted {
		background: #f3f4f6;
		color: #374151;
	}

	.badge-channel {
		background: #e0e7ff;
		color: #3730a3;
		text-transform: capitalize;
	}

	/* ── Project cards ────────────────────────────────── */
	.project-card {
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		margin-bottom: 0.75rem;
	}

	.project-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.stage-badge {
		display: inline-flex;
		align-items: center;
		background: #e0f2fe;
		color: #0369a1;
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.project-date {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.project-name {
		font-size: 1rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.25rem;
	}

	.project-meta {
		color: #6b7280;
		font-size: 0.8rem;
		margin: 0 0 0.75rem;
	}

	/* ── Buttons ──────────────────────────────────────── */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		background: #111827;
		color: #fff;
		text-decoration: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
		border: none;
		cursor: pointer;
	}

	.btn-primary:hover {
		background: #1f2937;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		background: #fff;
		color: #374151;
		text-decoration: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		border: 1px solid #d1d5db;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: #f9fafb;
	}

	/* ── Financial summary ────────────────────────────── */
	.summary-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.summary-card {
		padding: 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #f8fafc;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.summary-label {
		color: #6b7280;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}

	.summary-value {
		font-size: 1.15rem;
		font-weight: 800;
		color: #111827;
	}

	/* ── Card list / Invoice cards ────────────────────── */
	.card-list {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.invoice-card {
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
	}

	.invoice-info {
		margin-bottom: 0.6rem;
	}

	.invoice-number {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.35rem;
	}

	.invoice-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.meta-text {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.invoice-amounts {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.amount-row {
		display: flex;
		flex-direction: column;
	}

	.amount-label {
		font-size: 0.7rem;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.amount-value {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
	}

	.invoice-actions {
		display: flex;
		gap: 0.5rem;
	}

	.invoice-actions .btn-primary,
	.invoice-actions .btn-secondary {
		flex: 1;
	}

	/* ── Email timeline ───────────────────────────────── */
	.email-timeline {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.email-item {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.65rem 0.85rem;
		border-left: 3px solid transparent;
		border-radius: 0 8px 8px 0;
		background: #fafafa;
	}

	.email-outbound {
		border-left-color: #3b82f6;
	}

	.email-inbound {
		border-left-color: #10b981;
	}

	.email-item-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.email-item-labels {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.badge-outbound {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.badge-inbound {
		background: #d1fae5;
		color: #065f46;
	}

	.email-from {
		font-size: 0.75rem;
		color: #6b7280;
		font-weight: 500;
	}

	.email-time {
		color: #9ca3af;
		font-size: 0.75rem;
	}

	.email-subject {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #111827;
		line-height: 1.35;
	}

	.email-summary {
		margin: 0;
		font-size: 0.8rem;
		color: #6b7280;
		line-height: 1.4;
	}

	/* ── Email prefs (sub-section) ────────────────────── */
	.email-prefs-sub {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid #e5e7eb;
		display: grid;
		gap: 0.5rem;
	}

	.email-prefs-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
		color: #9ca3af;
	}

	.email-pref-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		flex-wrap: wrap;
	}

	.email-pref-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.email-pref-deal {
		font-weight: 700;
		font-size: 0.8rem;
		color: #111827;
	}

	.email-pref-email {
		color: #9ca3af;
		font-size: 0.7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.email-pref-card select {
		padding: 0.45rem 0.65rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		min-height: 44px;
		font-size: 0.85rem;
		background: #fff;
		color: #374151;
		-webkit-tap-highlight-color: transparent;
		flex-shrink: 0;
	}

	/* ── Photos ───────────────────────────────────────── */
	.doc-link-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: #111827;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn-sm {
		padding: 0.4rem 0.85rem;
		font-size: 0.8rem;
		min-height: 36px;
		flex-shrink: 0;
	}

	/* ── Project Overview ──────────────────────────────── */
	.overview-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.overview-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #f8fafc;
	}

	.overview-item-full {
		grid-column: 1 / -1;
	}

	.overview-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
		color: #9ca3af;
	}

	.overview-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: #111827;
	}

	.overview-text {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: #374151;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.notes-list {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.note-card {
		padding: 0.75rem 1rem;
		border-left: 3px solid #3b82f6;
		border-radius: 0 8px 8px 0;
		background: #f8fafc;
	}

	.note-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.note-date {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.note-author {
		font-size: 0.75rem;
		color: #6b7280;
		font-style: italic;
	}

	.note-content {
		margin: 0;
		font-size: 0.85rem;
		color: #374151;
		line-height: 1.45;
	}

	/* ── Contracts ────────────────────────────────────── */
	.contract-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.contract-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.contract-name {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	.contract-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	/* ── Documents ─────────────────────────────────────── */
	.doc-list {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}

	.doc-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #fff;
	}

	.doc-link {
		font-size: 0.85rem;
		font-weight: 500;
		color: #1d4ed8;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.doc-link:hover {
		text-decoration: underline;
	}

	/* ── Access Info ───────────────────────────────────── */
	.access-body {
		padding: 1rem 0.25rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 520px;
	}

	.access-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
		margin-top: 0.5rem;
	}

	.access-input {
		padding: 0.65rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9rem;
		min-height: 44px;
		background: #fff;
	}

	.access-btn {
		margin-top: 0.75rem;
		padding: 0.65rem 1rem;
		background: #111827;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
		align-self: flex-start;
	}

	.access-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.access-msg-ok {
		font-size: 0.82rem;
		color: #166534;
		margin: 0.25rem 0 0;
	}

	.access-msg-err {
		font-size: 0.82rem;
		color: #b91c1c;
		margin: 0.25rem 0 0;
	}

	/* ── Coming soon ──────────────────────────────────── */
	.coming-soon {
		font-style: italic;
	}

	/* ── Account section ──────────────────────────────── */
	.account-body {
		padding: 1rem 0.25rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.account-subhead {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.5rem;
	}

	.account-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
		margin-top: 0.5rem;
	}

	.account-input {
		padding: 0.65rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9rem;
		min-height: 44px;
		background: #fff;
	}

	.account-btn {
		margin-top: 0.75rem;
		padding: 0.65rem 1rem;
		background: #111827;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.account-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.account-message {
		font-size: 0.82rem;
		color: #374151;
		margin: 0.25rem 0 0;
	}

	.account-divider {
		height: 1px;
		background: #e5e7eb;
		margin: 0.75rem 0;
	}

	.account-logout {
		display: inline-flex;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 500;
		color: #9ca3af;
		text-decoration: none;
	}

	.account-logout:hover {
		color: #374151;
	}

	/* ── Desktop ──────────────────────────────────────── */
	@media (min-width: 640px) {
		.dashboard {
			padding: 2rem;
		}

		.page-header h1 {
			font-size: 1.65rem;
		}

		.page-subtitle {
			font-size: 0.9rem;
		}

		.section-header {
			font-size: 1.1rem;
			padding: 0.75rem 1rem;
		}

		.summary-value {
			font-size: 1.4rem;
		}

		.summary-label {
			font-size: 0.75rem;
		}

		.project-card {
			display: grid;
			grid-template-columns: 1fr auto;
			grid-template-rows: auto auto;
			gap: 0.5rem 1.5rem;
			align-items: center;
			padding: 1.25rem;
		}

		.project-top {
			grid-column: 1 / -1;
			margin-bottom: 0;
		}

		.project-name {
			font-size: 1.1rem;
			grid-column: 1;
		}

		.project-meta {
			grid-column: 1;
			margin-bottom: 0;
		}

		.project-actions {
			grid-column: 2;
			grid-row: 2 / 4;
			flex-direction: column;
		}

		.project-actions .btn-primary,
		.project-actions .btn-secondary {
			flex: none;
			white-space: nowrap;
		}

		.invoice-card {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: center;
			gap: 1rem;
			padding: 1rem 1.25rem;
		}

		.invoice-info {
			margin-bottom: 0;
		}

		.invoice-amounts {
			margin-bottom: 0;
			gap: 1.5rem;
		}

		.invoice-actions {
			flex-direction: column;
			gap: 0.4rem;
		}

		.invoice-actions .btn-primary,
		.invoice-actions .btn-secondary {
			flex: none;
			white-space: nowrap;
			min-width: 110px;
		}
	}
</style>
