<script lang="ts">
	const year = new Date().getFullYear();
</script>

<div class="admin-shell">
	<header class="admin-header">
		<div class="admin-header-inner">
			<a class="admin-logo" href="/admin/clients">CPR Admin</a>
			<nav class="admin-nav">
				<a class="admin-link" href="/admin/clients">Dashboard</a>
				<a class="admin-link" href="/admin/logout">Log out</a>
			</nav>
		</div>
	</header>

	<main class="admin-content">
		<slot />
	</main>

	<footer class="admin-footer">
		<div class="admin-footer-inner">© {year} CPR Portal</div>
	</footer>
</div>

<style>
	.admin-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.admin-header {
		position: sticky;
		top: 0;
		z-index: 2;
		background: rgba(255, 255, 255, 0.92);
		border-bottom: 1px solid #e5e5e5;
		backdrop-filter: blur(6px);
	}

	.admin-header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.85rem 2rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.admin-logo {
		font-weight: 700;
		text-decoration: none;
		color: #111827;
	}

	.admin-nav {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.admin-link {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.9rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		text-decoration: none;
		color: #1a1a1a;
		background: #fff;
	}

	.admin-link:hover {
		background: #f3f4f6;
	}

	.admin-content {
		flex: 1;
	}

	.admin-footer {
		margin-top: auto;
		border-top: 1px solid #e5e5e5;
		background: rgba(255, 255, 255, 0.9);
	}

	.admin-footer-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 2rem;
		color: #6b7280;
		font-size: 0.9rem;
	}
</style>
