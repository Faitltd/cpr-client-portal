<script lang="ts">
	export let data: {
		clients: { id: string; email: string; full_name?: string | null }[];
		tradePartners: { id: string; email: string; name?: string | null }[];
		designers: { id: string; email: string; name?: string | null; active?: boolean | null }[];
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
	$: sortedDesigners = [...(data?.designers || [])].sort((a, b) => {
		const aName = sortLabel(a.name) || sortLabel(a.email);
		const bName = sortLabel(b.name) || sortLabel(b.email);
		return aName.localeCompare(bName);
	});
</script>

<svelte:head>
	<title>Admin · CPR Portal</title>
</svelte:head>

<div class="container">
	<header class="page-head">
		<h1>Portal Administration</h1>
		<a class="portal-link" href="/designer">← Back to portal</a>
	</header>

	{#if form?.message}
		<p class="banner">{form.message}</p>
	{/if}

	<!-- Zoho connection & sync -->
	<section class="card">
		<h2 class="card-title">Zoho Sync</h2>
		<div class="action-row">
			<form method="POST" action="?/sync">
				<button class="btn btn-sync" type="submit">Sync Clients</button>
			</form>
			<form method="POST" action="?/syncTradePartners">
				<button class="btn btn-sync" type="submit">Sync Trade Partners</button>
			</form>
			<form method="POST" action="?/auditProjects">
				<button class="btn btn-ghost" type="submit">Audit Project Mapping</button>
			</form>
			<a class="btn btn-dark" href="/auth/login">Reconnect Zoho OAuth</a>
		</div>
	</section>

	{#if form?.audit}
		<section class="card audit-card">
			<h2 class="card-title">Project Mapping Audit</h2>
			<div class="audit-grid">
				<div class="stat"><span class="stat-num">{form.audit.scannedDeals}</span><span class="stat-label">Deals scanned</span></div>
				<div class="stat"><span class="stat-num">{form.audit.activeDeals}</span><span class="stat-label">Active-stage</span></div>
				<div class="stat"><span class="stat-num">{form.audit.mappedDeals}</span><span class="stat-label">Mapped</span></div>
				<div class="stat"><span class="stat-num">{form.audit.missingDeals}</span><span class="stat-label">Missing ({form.audit.missingPercent}%)</span></div>
				<div class="stat"><span class="stat-num">{form.audit.mappedProjectIds}</span><span class="stat-label">Project IDs</span></div>
				<div class="stat"><span class="stat-num">{form.audit.resolvedProjects}</span><span class="stat-label">Resolved</span></div>
			</div>
			{#if form.audit.projectsError}
				<p class="audit-error">Projects lookup error: {form.audit.projectsError}</p>
			{/if}
			{#if form.audit.topStages.length > 0}
				<p class="audit-note">Top active stages: {form.audit.topStages.join(', ')}</p>
			{/if}
			{#if form.audit.sampleProjects.length > 0}
				<details>
					<summary>Resolved projects ({form.audit.sampleProjects.length})</summary>
					<ul>
						{#each form.audit.sampleProjects as project}
							<li>
								<strong>{project.name || 'Untitled project'}</strong>
								<span> [{project.projectId}]</span>
								{#if project.status}<span> • {project.status}</span>{/if}
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

	<!-- Passwords -->
	<section class="card">
		<h2 class="card-title">Passwords</h2>
		<p class="hint">New client logins default to email as username and phone number as password.</p>
		<div class="pw-grid">
			<form method="POST" action="?/setPassword" class="pw-form">
				<span class="pw-role">Client</span>
				<label class="sr-only" for="client_id">Client</label>
				<select id="client_id" name="client_id">
					<option value="">Select a client</option>
					{#each sortedClients as client}
						<option value={client.id}>{client.full_name || client.email} ({client.email})</option>
					{/each}
				</select>
				<label class="sr-only" for="password">New password</label>
				<input id="password" name="password" type="password" placeholder="New password" />
				<button class="btn btn-dark" type="submit">Set Password</button>
			</form>

			<form method="POST" action="?/setTradePassword" class="pw-form">
				<span class="pw-role">Trade Partner</span>
				<label class="sr-only" for="trade_partner_id">Trade partner</label>
				<select id="trade_partner_id" name="trade_partner_id">
					<option value="">Select a trade partner</option>
					{#each sortedTradePartners as partner}
						<option value={partner.id}>{partner.name || partner.email} ({partner.email})</option>
					{/each}
				</select>
				<label class="sr-only" for="trade_password">New password</label>
				<input id="trade_password" name="password" type="password" placeholder="New password" />
				<button class="btn btn-dark" type="submit">Set Password</button>
			</form>

			<form method="POST" action="?/setDesignerPassword" class="pw-form">
				<span class="pw-role">Designer</span>
				<label class="sr-only" for="designer_id">Designer</label>
				<select id="designer_id" name="designer_id">
					<option value="">Select a designer</option>
					{#each sortedDesigners as designer}
						<option value={designer.id}>
							{designer.name || designer.email} ({designer.email}){designer.active === false ? ' - inactive' : ''}
						</option>
					{/each}
				</select>
				<label class="sr-only" for="designer_password">New password</label>
				<input id="designer_password" name="password" type="password" placeholder="New password" />
				<button class="btn btn-dark" type="submit">Set Password</button>
			</form>
		</div>
	</section>
</div>

<style>
	.container {
		max-width: 960px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 3rem;
		display: grid;
		gap: 1rem;
	}

	.page-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
	}

	.portal-link {
		color: #334155;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
	}

	.portal-link:hover {
		color: #0f172a;
		text-decoration: underline;
	}

	.banner {
		margin: 0;
		padding: 0.7rem 1rem;
		border-radius: 10px;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
		font-size: 0.92rem;
	}

	.card {
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		padding: 1.1rem 1.25rem 1.25rem;
	}

	.card-title {
		margin: 0 0 0.75rem;
		font-size: 0.82rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #374151;
	}

	.hint {
		margin: -0.35rem 0 0.85rem;
		color: #6b7280;
		font-size: 0.85rem;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1rem;
		border: 1px solid transparent;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.9rem;
		min-height: 40px;
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	.btn-dark {
		background: #111827;
		color: #fff;
	}

	.btn-dark:hover {
		background: #1f2937;
	}

	.btn-sync {
		background: #0f766e;
		color: #fff;
	}

	.btn-sync:hover {
		background: #115e59;
	}

	.btn-ghost {
		background: #fff;
		color: #111827;
		border-color: #d1d5db;
	}

	.btn-ghost:hover {
		background: #f3f4f6;
	}

	.action-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	/* Password forms */
	.pw-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem;
	}

	.pw-form {
		display: grid;
		gap: 0.55rem;
		padding: 0.9rem;
		border: 1px solid #eef2f7;
		border-radius: 10px;
		background: #f8fafc;
		align-content: start;
	}

	.pw-role {
		font-weight: 700;
		font-size: 0.9rem;
		color: #111827;
	}

	select,
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.7rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font: inherit;
		font-size: 0.9rem;
		min-height: 40px;
		background: #fff;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	/* Audit */
	.audit-card {
		border-color: #bfdbfe;
		background: #f8fbff;
	}

	.audit-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 0.6rem;
		margin-bottom: 0.5rem;
	}

	.stat {
		display: grid;
		gap: 0.1rem;
		padding: 0.6rem 0.7rem;
		background: #fff;
		border: 1px solid #dbeafe;
		border-radius: 10px;
	}

	.stat-num {
		font-size: 1.15rem;
		font-weight: 700;
		color: #1e3a8a;
	}

	.stat-label {
		font-size: 0.75rem;
		color: #475569;
	}

	.audit-error {
		margin: 0.5rem 0 0;
		color: #b91c1c;
		font-size: 0.88rem;
	}

	.audit-note {
		margin: 0.5rem 0 0;
		color: #1e3a8a;
		font-size: 0.88rem;
	}

	.audit-card details {
		margin-top: 0.7rem;
	}

	.audit-card summary {
		cursor: pointer;
		font-weight: 600;
		color: #1e3a8a;
		font-size: 0.9rem;
	}

	.audit-card ul {
		margin: 0.6rem 0 0;
		padding-left: 1.1rem;
	}

	.audit-card li {
		margin: 0.35rem 0;
		color: #1f2937;
		font-size: 0.88rem;
	}

	@media (max-width: 640px) {
		.container {
			padding: 1.25rem 1rem 2.5rem;
		}

		.action-row .btn,
		.action-row form {
			width: 100%;
		}
	}
</style>
