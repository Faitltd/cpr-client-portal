<script lang="ts">
	import { page } from '$app/stores';

	$: pathname = $page.url.pathname;
	$: isLogin = pathname === '/admin/login';
	$: isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
</script>

<!-- Mirrors the designer portal chrome exactly: same header, same tab bar,
     same content width — so switching between /designer and /admin tabs
     doesn't change the layout. -->
<div class="admin-shell">
	<header class="portal-header">
		<div class="portal-header-inner">
			<a class="portal-logo" href="/designer">
				<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
					<rect width="28" height="28" rx="6" fill="#111827"/>
					<text x="14" y="19" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="system-ui">C</text>
				</svg>
				<span>CPR</span>
			</a>
			<a class="header-logout" href="/admin/logout">Log out</a>
		</div>
	</header>

	{#if !isLogin}
		<div class="designer-bar">
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
						<a class="tab tab-admin" class:active={isActive('/admin/bot')} href="/admin/bot">CPR Assistant</a>
						<a class="tab tab-admin" class:active={isActive('/admin/schedule')} href="/admin/schedule">Schedule</a>
						<a class="tab tab-admin" class:active={isActive('/admin/process-map')} href="/admin/process-map">Process Map</a>
						<a class="tab tab-admin" class:active={isActive('/admin/takeoffs')} href="/admin/takeoffs">Est./T.O.'s</a>
					</span>
				</nav>
			</div>
		</div>
	{/if}

	<main class="admin-content">
		<slot />
	</main>
</div>

<style>
	.admin-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 100%;
		overflow-x: clip;
	}

	/* ── Header — identical to the root portal header ── */
	.portal-header {
		position: sticky;
		top: 0;
		z-index: 100;
		background: rgba(255, 255, 255, 0.95);
		border-bottom: 1px solid #e5e7eb;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.portal-header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem;
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.portal-logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 800;
		font-size: 1.1rem;
		text-decoration: none;
		color: #111827;
		letter-spacing: -0.01em;
	}

	.header-logout {
		font-size: 0.85rem;
		font-weight: 500;
		color: #9ca3af;
		text-decoration: none;
		padding: 0.45rem 0.75rem;
		border-radius: 8px;
		transition: color 0.15s;
	}

	.header-logout:hover {
		color: #374151;
	}

	/* ── Tab bar — identical to the designer portal bar ── */
	.designer-bar {
		position: sticky;
		top: 56px;
		z-index: 30;
		background: #ffffff;
	}

	.bar-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1rem 1rem 0;
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

	/* ── Content — same width as designer-content ────── */
	.admin-content {
		flex: 1;
		width: 100%;
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
		box-sizing: border-box;
	}
</style>
