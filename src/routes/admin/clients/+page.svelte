<script lang="ts">
	export let data: {
		clients: { id: string; email: string; full_name?: string | null }[];
		tradePartners: { id: string; email: string; name?: string | null }[];
	};
	export let form:
		| {
				message?: string;
					audit?: {
						scannedDeals: number;
						activeDeals: number;
						mappedDeals: number;
						missingDeals: number;
						missingPercent: number;
						mappedProjectIds: number;
						resolvedProjects: number;
						unresolvedProjectIds: string[];
						sampleProjects: Array<{
							projectId: string;
							name: string | null;
							status: string | null;
							startDate: string | null;
							endDate: string | null;
						}>;
						projectsError: string | null;
						topStages: string[];
						sampleMissingDeals: Array<{
							dealId: string;
							dealName: string | null;
							stage: string | null;
						contactName: string | null;
						modifiedTime: string | null;
					}>;
				};
		  }
		| undefined;

	const sortLabel = (value: string | null | undefined) => (value || '').toLowerCase();
	$: sortedClients = [...(data?.clients || [])].sort((a, b) => {
		const aName = sortLabel(a.full_name) || sortLabel(a.email);
		const bName = sortLabel(b.full_name) || sortLabel(b.email);
		return aName.localeCompare(bName);
	});
	$: sortedTradePartners = [...(data?.tradePartners || [])].sort((a, b) => {
		const aName = sortLabel(a.name) || sortLabel(a.email);
		const bName = sortLabel(b.name) || sortLabel(b.email);
		return aName.localeCompare(bName);
	});
</script>

<div class="container">
	<header>
		<div>
			<h1>Client Passwords</h1>
			<p>Set or reset a client password without email.</p>
		</div>
		<a class="logout" href="/admin/logout">Logout</a>
	</header>

	<div class="actions">
		<form method="POST" action="?/sync" class="sync-form">
			<button type="submit">Sync Clients from Zoho</button>
		</form>
		<form method="POST" action="?/syncTradePartners" class="sync-form">
			<button type="submit">Sync Trade Partners</button>
		</form>
		<form method="POST" action="?/auditProjects" class="sync-form">
			<button type="submit">Audit Project Mapping</button>
		</form>
		<a class="oauth-button" href="/auth/login">Reconnect Zoho OAuth</a>
		{#if form?.message}
			<p class="message">{form.message}</p>
		{/if}
		{#if form?.audit}
			<section class="audit-card">
				<h2>Project Mapping Audit</h2>
				<p>Deals scanned: {form.audit.scannedDeals}</p>
				<p>Active-stage deals: {form.audit.activeDeals}</p>
				<p>Mapped deals: {form.audit.mappedDeals}</p>
				<p>Missing mappings: {form.audit.missingDeals} ({form.audit.missingPercent}%)</p>
				<p>Unique mapped project IDs: {form.audit.mappedProjectIds}</p>
				<p>Resolved Zoho Projects: {form.audit.resolvedProjects}</p>
				{#if form.audit.projectsError}
					<p>Projects lookup error: {form.audit.projectsError}</p>
				{/if}
				{#if form.audit.topStages.length > 0}
					<p>Top active stages: {form.audit.topStages.join(', ')}</p>
				{/if}
				{#if form.audit.sampleProjects.length > 0}
					<details>
						<summary>Resolved projects ({form.audit.sampleProjects.length})</summary>
						<ul>
							{#each form.audit.sampleProjects as project}
								<li>
									<strong>{project.name || 'Untitled project'}</strong>
									<span> [{project.projectId}]</span>
									{#if project.status}
										<span> • {project.status}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
				{#if form.audit.unresolvedProjectIds.length > 0}
					<details>
						<summary>Unresolved project IDs ({form.audit.unresolvedProjectIds.length})</summary>
						<ul>
							{#each form.audit.unresolvedProjectIds as id}
								<li>{id}</li>
							{/each}
						</ul>
					</details>
				{/if}
				{#if form.audit.sampleMissingDeals.length > 0}
					<details>
						<summary>Sample missing deals ({form.audit.sampleMissingDeals.length})</summary>
						<ul>
							{#each form.audit.sampleMissingDeals as deal}
								<li>
									<strong>{deal.dealName || 'Untitled deal'}</strong>
									<span> [{deal.dealId}]</span>
									<span> • {deal.stage || 'No stage'}</span>
									<span> • {deal.contactName || 'No contact'}</span>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</section>
		{/if}
	</div>

	<form method="POST" action="?/setPassword" class="card">
		<label for="client_id">Client</label>
		<select id="client_id" name="client_id">
			<option value="">Select a client</option>
			{#each sortedClients as client}
				<option value={client.id}>{client.full_name || client.email} ({client.email})</option>
			{/each}
		</select>

		<label for="password">New Password</label>
		<input id="password" name="password" type="password" />

		<button type="submit">Set Password</button>
	</form>

	<form method="POST" action="?/setTradePassword" class="card trade-card">
		<label for="trade_partner_id">Trade Partner</label>
		<select id="trade_partner_id" name="trade_partner_id">
			<option value="">Select a trade partner</option>
			{#each sortedTradePartners as partner}
				<option value={partner.id}>{partner.name || partner.email} ({partner.email})</option>
			{/each}
		</select>

		<label for="trade_password">New Password</label>
		<input id="trade_password" name="password" type="password" />

		<button type="submit">Set Trade Partner Password</button>
	</form>

</div>

<style>
	.container {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.logout {
		text-decoration: none;
		color: #1a1a1a;
		border: 1px solid #ddd;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: #fff;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.trade-card {
		margin-top: 1.5rem;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	select,
	input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		margin-bottom: 1rem;
		min-height: 44px;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		border: none;
		border-radius: 6px;
		background: #0066cc;
		color: white;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
	}

	.actions {
		margin-bottom: 1.5rem;
		display: grid;
		gap: 0.75rem;
	}

	.sync-form {
		display: grid;
		gap: 0.5rem;
	}

	.sync-form button {
		background: #0f766e;
	}

	.oauth-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.75rem;
		border-radius: 6px;
		background: #1f2937;
		color: #fff;
		font-weight: 600;
		text-decoration: none;
		min-height: 44px;
	}

	.oauth-button:hover {
		background: #111827;
	}

	.message {
		margin-top: 0.5rem;
		color: #065f46;
	}

	.audit-card {
		border: 1px solid #bfdbfe;
		background: #eff6ff;
		border-radius: 8px;
		padding: 1rem;
	}

	.audit-card h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.audit-card p {
		margin: 0.35rem 0;
		color: #1e3a8a;
	}

	.audit-card details {
		margin-top: 0.75rem;
	}

	.audit-card summary {
		cursor: pointer;
		font-weight: 600;
		color: #1e3a8a;
	}

	.audit-card ul {
		margin: 0.75rem 0 0;
		padding-left: 1rem;
	}

	.audit-card li {
		margin: 0.4rem 0;
		color: #1f2937;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		header {
			flex-direction: column;
			align-items: stretch;
		}

		.logout {
			width: 100%;
		}

		.card {
			padding: 1.25rem;
		}
	}

</style>
