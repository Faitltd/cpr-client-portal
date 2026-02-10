<script lang="ts">
	export let data: {
		clients: { id: string; email: string; full_name?: string | null }[];
		tradePartners: { id: string; email: string; name?: string | null }[];
	};
	export let form: { message?: string } | undefined;

	const sortLabel = (value: string | null | undefined) => (value || '').toLowerCase();
	$: sortedClients = [...(data?.clients || [])].sort((a, b) => {
		const aName = sortLabel(a.full_name) || sortLabel(a.email);
		const bName = sortLabel(b.full_name) || sortLabel(b.email);
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
		<form method="POST" action="?/debugDealStages" class="sync-form">
			<button type="submit">Debug Deal Stages</button>
		</form>
		<form method="POST" action="?/debugTradePartner" class="sync-form">
			<label for="debug_trade_partner_id">Debug Trade Partner (Zoho ID)</label>
			<input id="debug_trade_partner_id" name="zoho_trade_partner_id" type="text" />
			<button type="submit">Debug Trade Partner</button>
		</form>
		<a class="oauth-button" href="/auth/login">Reconnect Zoho OAuth</a>
		{#if form?.message}
			<p class="message">{form.message}</p>
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
			{#each data.tradePartners as partner}
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
