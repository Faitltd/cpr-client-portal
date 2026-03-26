<script lang="ts">
	const year = new Date().getFullYear();
</script>

<div class="admin-shell">
	<header class="admin-header">
		<div class="admin-header-inner">
			<a class="admin-logo" href="/admin">
				<img src="/favicon.png" alt="CPR Remodeling" width="32" height="32" style="object-fit:contain;" />
				<span>Admin</span>
			</a>
			<div class="header-actions">
			<a class="client-admin-btn" href="/admin/clients">Client Admin</a>
			<a class="logout-link" href="/admin/logout">Log out</a>
		</div>
		</div>
	</header>

	<main class="admin-content">
		<slot />
	</main>

	<footer class="admin-footer">
		<div class="admin-footer-inner">&copy; {year} CPR Portal</div>
	</footer>
</div>

<style>
	.admin-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	}

	/* ── Header ──────────────────────────────────────── */
	.admin-header {
		position: sticky;
		top: 0;
		z-index: 100;
		background: rgba(255, 255, 255, 0.95);
		border-bottom: 1px solid #e5e7eb;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.admin-header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.admin-logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 800;
		font-size: 1.1rem;
		text-decoration: none;
		color: #111827;
		letter-spacing: -0.01em;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.client-admin-btn {
		font-size: 0.82rem;
		font-weight: 600;
		color: #fff;
		background: #111827;
		text-decoration: none;
		padding: 0.35rem 0.85rem;
		border-radius: 6px;
		white-space: nowrap;
	}

	.client-admin-btn:hover {
		background: #374151;
	}

	.logout-link {
		font-size: 0.85rem;
		font-weight: 500;
		color: #6b7280;
		text-decoration: none;
	}

	.logout-link:hover {
		color: #111827;
	}

	/* ── Content & Footer ────────────────────────────── */
	.admin-content {
		flex: 1;
	}

	.admin-footer {
		margin-top: auto;
		border-top: 1px solid #e5e7eb;
		background: rgba(255, 255, 255, 0.9);
	}

	.admin-footer-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 1.5rem;
		color: #9ca3af;
		font-size: 0.8rem;
	}

	@media (min-width: 768px) {
		.admin-header-inner {
			padding: 0 2rem;
		}

		.admin-footer-inner {
			padding: 1rem 2rem;
		}
	}
</style>
