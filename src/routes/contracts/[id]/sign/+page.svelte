<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let loading = true;
	let error = '';
	let signUrl = '';
	let name = '';
	let status = '';

	const requestId = $page.params.id;

	onMount(async () => {
		try {
			const res = await fetch(`/api/sign/requests/${requestId}/sign`);
			const payload = await res.json().catch(() => ({}));

			if (res.status === 401) {
				error = 'Please login again to sign this contract.';
				return;
			}

			if (!res.ok) {
				error = payload?.message || 'Failed to load signing link.';
				return;
			}

			const data = payload?.data || {};
			signUrl = data.sign_url || '';
			name = data.name || 'Contract';
			status = data.status || '';

			if (!signUrl) {
				error = 'Signing link unavailable. Please contact support.';
			}
		} catch {
			error = 'Failed to load signing link.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="contract-sign">
	<nav>
		<a href="/dashboard">← Back to Dashboard</a>
	</nav>

	<header>
		<h1>{name || 'Contract'}</h1>
		{#if status}
			<p class="meta">Status: {status}</p>
		{/if}
	</header>

	{#if loading}
		<div class="card">Loading contract signing...</div>
	{:else if error}
		<div class="card error">
			<p>{error}</p>
			<a href="/auth/client">Go to login</a>
		</div>
	{:else}
		<div class="actions">
			<a class="btn-secondary" href={signUrl} target="_blank" rel="noreferrer">
				Open in new tab
			</a>
		</div>
		<div class="frame">
			<iframe title="Contract Signing" src={signUrl} allow="clipboard-write"></iframe>
		</div>
	{/if}
</div>

<style>
	.contract-sign {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	nav {
		margin-bottom: 1.5rem;
	}

	nav a {
		color: #0066cc;
		text-decoration: none;
	}

	header {
		margin-bottom: 1.5rem;
	}

	.meta {
		color: #666;
		margin-top: 0.4rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.error {
		color: #b91c1c;
		background: #fef2f2;
		border-color: #fecaca;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 1rem;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 1rem;
		border: 1px solid #d0d0d0;
		border-radius: 6px;
		text-decoration: none;
		color: #1a1a1a;
		background: #fff;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
	}

	.frame {
		border: 1px solid #e0e0e0;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		min-height: 600px;
	}

	.frame iframe {
		border: none;
		width: 100%;
		height: 80vh;
		min-height: 600px;
	}
</style>
