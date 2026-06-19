<script lang="ts">
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	let busy = $state<string | null>(null);
	let status = $state('');

	async function promote(id: string) {
		busy = id;
		status = '';
		try {
			const res = await fetch(`/api/admin/bot/users/${id}/primary`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
			status = 'Primary updated. Reloading…';
			setTimeout(() => location.reload(), 600);
		} catch (err) {
			status = `Failed: ${err instanceof Error ? err.message : 'unknown'}`;
		} finally {
			busy = null;
		}
	}

	async function remove(id: string) {
		if (!confirm('Remove this user’s Zoho token? They will need to re-authorize to restore.')) return;
		busy = id;
		status = '';
		try {
			const res = await fetch(`/api/admin/bot/users/${id}`, { method: 'DELETE' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
			status = 'Removed. Reloading…';
			setTimeout(() => location.reload(), 600);
		} catch (err) {
			status = `Failed: ${err instanceof Error ? err.message : 'unknown'}`;
		} finally {
			busy = null;
		}
	}

	function fmtDate(s: string): string {
		try {
			return new Date(s).toLocaleString();
		} catch {
			return s;
		}
	}
</script>

<svelte:head>
	<title>CPR Assistant Users — CPR Admin</title>
</svelte:head>

<section class="page">
	<header class="head">
		<div>
			<h1>Connected Zoho Users</h1>
			<p class="sub">
				Each CPR team member must connect once so CPR Assistant can read their CRM-linked emails.
				The primary user is what CPR Assistant uses for CRM, Cliq, and Books operations.
			</p>
		</div>
		<a class="link" href="/admin/bot">← Back to chat</a>
	</header>

	<div class="add-block">
		<h2>Add another user</h2>
		<ol>
			<li>Open <a href="https://accounts.zoho.com/u/h/logout" target="_blank" rel="noopener">accounts.zoho.com/u/h/logout</a> in a new tab. Make sure that tab actually signs out.</li>
			<li>In the same tab, sign in as the team member you want to add (Mary Sue, Jeff, info@, Monika, Sean).</li>
			<li>Open <a href="/auth/login" target="_blank" rel="noopener">/auth/login</a> in another tab. Accept the consent screen.</li>
			<li>You'll land back here. The new user appears below.</li>
		</ol>
		{#if status}
			<div class="status">{status}</div>
		{/if}
	</div>

	<h2>Connected users ({data.tokens.length})</h2>

	{#if data.tokens.length === 0}
		<div class="empty">No Zoho users connected yet.</div>
	{:else}
		<table class="tokens-table">
			<thead>
				<tr>
					<th>User</th>
					<th>User ID</th>
					<th>Token expires</th>
					<th>Primary?</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tokens as t (t.id)}
					<tr class:is-primary={t.is_primary}>
						<td>{t.user_email ?? '—'}</td>
						<td class="mono">{t.user_id}</td>
						<td>{fmtDate(t.expires_at)}</td>
						<td>
							{#if t.is_primary}
								<span class="pill primary">primary</span>
							{:else}
								<span class="pill">secondary</span>
							{/if}
						</td>
						<td class="actions-cell">
							{#if !t.is_primary}
								<button type="button" disabled={busy !== null} onclick={() => promote(t.id)}>
									Make primary
								</button>
							{/if}
							<button class="danger" type="button" disabled={busy !== null} onclick={() => remove(t.id)}>
								Remove
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
	}
	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 1.5rem 0 0.5rem;
		color: #111827;
	}
	.sub {
		margin: 0;
		color: #6b7280;
		font-size: 0.95rem;
		max-width: 720px;
	}
	.link {
		color: #2563eb;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.add-block {
		border: 1px solid #bfdbfe;
		background: #eff6ff;
		border-radius: 0.5rem;
		padding: 1rem 1.25rem;
		margin-bottom: 1.5rem;
	}
	.add-block h2 {
		margin-top: 0;
		color: #1d4ed8;
	}
	.add-block ol {
		margin: 0;
		padding-left: 1.25rem;
		color: #1e3a8a;
	}
	.add-block li {
		margin: 0.25rem 0;
	}
	.status {
		margin-top: 0.75rem;
		padding: 0.5rem 0.8rem;
		background: #ffffff;
		border-radius: 0.4rem;
		color: #075985;
		font-size: 0.9rem;
	}
	.empty {
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		border: 1px dashed #d1d5db;
		border-radius: 0.5rem;
	}
	.tokens-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}
	.tokens-table th,
	.tokens-table td {
		text-align: left;
		padding: 0.55rem 0.7rem;
		border-bottom: 1px solid #e5e7eb;
	}
	.tokens-table th {
		background: #f9fafb;
		font-weight: 600;
		color: #374151;
		font-size: 0.85rem;
	}
	.is-primary td {
		background: #f0fdf4;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8rem;
		color: #6b7280;
	}
	.pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		background: #e5e7eb;
		color: #374151;
		font-size: 0.75rem;
	}
	.pill.primary {
		background: #15803d;
		color: #ffffff;
	}
	.actions-cell {
		display: flex;
		gap: 0.35rem;
	}
	.actions-cell button {
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
		border: 1px solid #d1d5db;
		border-radius: 0.4rem;
		background: #ffffff;
		cursor: pointer;
	}
	.actions-cell button.danger {
		color: #b91c1c;
		border-color: #fecaca;
	}
	.actions-cell button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
