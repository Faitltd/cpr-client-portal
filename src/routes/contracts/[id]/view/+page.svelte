<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let loading = true;
	let error = '';
	let viewUrl = '';
	let pdfUrl = '';
	let name = '';
	let status = '';
	let redirected = false;

	const requestId = $page.params.id;

	onMount(async () => {
		const presetUrl = $page.url.searchParams.get('url') || '';
		pdfUrl = `/api/sign/requests/${requestId}/pdf`;
		try {
			const res = await fetch(`/api/sign/requests/${requestId}/view`);
			const payload = await res.json().catch(() => ({}));

			if (res.status === 401) {
				if (!presetUrl) {
					error = 'Please login again to view this contract.';
				}
				return;
			}

			if (!res.ok) {
				if (!presetUrl) {
					error = payload?.message || 'Failed to load contract.';
				}
				return;
			}

			const data = payload?.data || {};
			viewUrl = data.view_url || '';
			name = data.name || 'Contract';
			status = data.status || '';
		} catch {
			if (!presetUrl) {
				error = 'Failed to load contract.';
			}
		} finally {
			if (!viewUrl && presetUrl) {
				viewUrl = presetUrl;
			}
			if (!viewUrl && pdfUrl) {
				viewUrl = pdfUrl;
			}
			const authError = error.toLowerCase().includes('login');
			if (viewUrl && !authError) {
				error = '';
			}
			if (!viewUrl && !error) {
				error = 'View link unavailable. Please contact support.';
			}
			if (viewUrl && typeof window !== 'undefined' && !redirected) {
				redirected = true;
				window.location.assign(viewUrl);
			}
			loading = false;
		}
	});
</script>

<div class="contract-view">
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
		<div class="card">Loading contract...</div>
	{:else if error}
		<div class="card error">
			<p>{error}</p>
			<a href="/auth/client">Go to login</a>
		</div>
	{:else}
		<div class="actions">
			<p class="redirect-note">Redirecting you to the contract...</p>
			<a class="btn-secondary" href={viewUrl} target="_blank" rel="noreferrer">
				{viewUrl === pdfUrl ? 'Download PDF' : 'Continue to Contract'}
			</a>
		</div>
	{/if}
</div>

<style>
	.contract-view {
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
		display: grid;
		gap: 0.75rem;
		align-items: center;
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
		min-height: 44px;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
	}

	.redirect-note {
		margin: 0;
		color: #374151;
	}

	@media (max-width: 720px) {
		.contract-view {
			padding: 1.5rem 1.25rem;
		}

		.actions {
			justify-content: stretch;
		}

		.btn-secondary {
			width: 100%;
			justify-content: center;
		}
	}
</style>
