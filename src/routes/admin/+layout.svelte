<script lang="ts">
	import { page } from '$app/stores';

	const year = new Date().getFullYear();
	$: pathname = $page.url.pathname;
	$: isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
</script>

<div class="admin-shell">
	<header class="admin-header">
		<div class="admin-header-inner">
			<a class="admin-logo" href="/designer">
				<img src="/favicon.png" alt="CPR Remodeling" width="32" height="32" style="object-fit:contain;" />
				<span>Admin</span>
			</a>
			<a class="logout-link" href="/admin/logout">Log out</a>
		</div>
		<!-- Same tab row as the designer portal, plus the admin tabs -->
		{#if pathname !== '/admin/login'}
		<div class="bar-inner">
			<nav class="tabs" aria-label="Portal views">
				<a class="tab" href="/designer/trade-dashboard">Field Dashboard</a>
				<a class="tab" href="/designer/field-update">Field Update</a>
				<a class="tab" href="/designer">CRM</a>
				<a class="tab" href="/designer/tasks">Tasks</a>
				<a class="tab" href="/designer/financials">Financials</a>
				<span class="admin-group" aria-label="Admin tabs">
					<a class="tab tab-admin" class:active={isActive('/admin/clients')} href="/admin/clients">Client Admin</a>
					<a class="tab tab-admin" class:active={isActive('/admin/leads')} href="/admin/leads">Leads</a>
					<a class="tab tab-admin" class:active={isActive('/admin/bot')} href="/admin/bot">Bot</a>
					<a class="tab tab-admin" class:active={isActive('/admin/process-map')} href="/admin/process-map">Process Map</a>
				</span>
			</nav>
		</div>
		{/if}
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
		width: 100%;
		max-width: 100%;
		overflow-x: clip;
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
		max-width: 1100px;
		margin: 0 auto;
		padding: 0 1rem;
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
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

	.logout-link {
		font-size: 0.85rem;
		font-weight: 500;
		color: #6b7280;
		text-decoration: none;
	}

	.logout-link:hover {
		color: #111827;
	}

	/* ── Tab row (matches the designer portal) ───────── */
	.bar-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 0 1rem 0.75rem;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		background: #eef2f7;
		padding: 0.35rem;
		border-radius: 0.7rem;
	}

	.tab {
		padding: 0.5rem 1rem;
		color: #334155;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
		border-radius: 0.5rem;
		border: 1px solid transparent;
		background: transparent;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.tab:hover {
		background: #dbe3ee;
		color: #0f172a;
	}

	.tab.active {
		background: #111827;
		color: #ffffff;
		border-color: #111827;
	}

	.admin-group {
		margin-left: auto;
		display: inline-flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.tab-admin {
		border-color: #b45309;
		color: #92400e;
	}

	.tab-admin:hover {
		background: #fff7ed;
		color: #7c2d12;
	}

	.tab-admin.active {
		background: #92400e;
		color: #fff;
		border-color: #92400e;
	}

	/* ── Content & Footer ────────────────────────────── */
	.admin-content {
		flex: 1;
		width: 100%;
		max-width: 100%;
	}

	.admin-footer {
		margin-top: auto;
		border-top: 1px solid #e5e7eb;
		background: rgba(255, 255, 255, 0.9);
	}

	.admin-footer-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1rem 1.5rem;
		color: #9ca3af;
		font-size: 0.8rem;
	}

	@media (max-width: 767px) {
		.admin-header-inner {
			padding-top: 0.6rem;
			padding-bottom: 0.6rem;
		}
	}
</style>
