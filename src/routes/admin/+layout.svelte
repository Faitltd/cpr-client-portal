<script lang="ts">
	import { page } from '$app/stores';

	const year = new Date().getFullYear();
	$: pathname = $page.url.pathname;
	$: if (pathname) drawerOpen = false;

	let drawerOpen = false;

	const isActive = (href: string) => {
		if (href === '/admin' && pathname === '/admin') return true;
		if (href !== '/admin' && pathname.startsWith(href)) return true;
		return false;
	};

	const navGroups = [
		{
			label: 'Overview',
			items: [
				{ href: '/admin', label: 'Dashboard', icon: 'grid' },
				{ href: '/admin/health', label: 'Health', icon: 'heart' }
			]
		},
		{
			label: 'Operations',
			items: [
				{ href: '/admin/zprojects', label: 'Projects', icon: 'folder' },
				{ href: '/admin/approvals', label: 'Approvals', icon: 'check' },
				{ href: '/admin/change-orders', label: 'Change Orders', icon: 'edit' },
				{ href: '/admin/procurement', label: 'Procurement', icon: 'box' },
				{ href: '/admin/daily-logs', label: 'Daily Logs', icon: 'clipboard' },
				{ href: '/admin/field-issues', label: 'Issues', icon: 'alert' }
			]
		},
		{
			label: 'Communication',
			items: [
				{ href: '/admin/comms', label: 'Comms', icon: 'message' },
				{ href: '/admin/email-updates', label: 'Email Updates', icon: 'mail' },
				{ href: '/admin/clients', label: 'Clients', icon: 'users' }
			]
		},
		{
			label: 'Configuration',
			items: [
				{ href: '/admin/task-library', label: 'Task Library', icon: 'layers' },
				{ href: '/admin/scope', label: 'Scope', icon: 'target' },
				{ href: '/admin/folder-cache', label: 'Folder Cache', icon: 'database' },
				{ href: '/admin/api-cache', label: 'API Cache', icon: 'server' }
			]
		}
	];
</script>

<div class="admin-shell">
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	{#if drawerOpen}
		<div class="drawer-backdrop" on:click={() => (drawerOpen = false)} role="presentation"></div>
	{/if}

	<header class="admin-header">
		<div class="admin-header-inner">
			<a class="admin-logo" href="/admin">
				<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
					<rect width="28" height="28" rx="6" fill="#111827"/>
					<text x="14" y="19" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="system-ui">C</text>
				</svg>
				<span>Admin</span>
			</a>

			<button
				class="hamburger"
				type="button"
				aria-label="Open menu"
				aria-expanded={drawerOpen}
				on:click={() => (drawerOpen = !drawerOpen)}
			>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					{#if drawerOpen}
						<line x1="6" y1="6" x2="18" y2="18" />
						<line x1="6" y1="18" x2="18" y2="6" />
					{:else}
						<line x1="3" y1="7" x2="21" y2="7" />
						<line x1="3" y1="12" x2="21" y2="12" />
						<line x1="3" y1="17" x2="21" y2="17" />
					{/if}
				</svg>
			</button>

			<!-- Desktop: condensed horizontal nav for most-used items -->
			<nav class="admin-nav-desktop">
				<a class="nav-item" class:active={isActive('/admin')} href="/admin">Dashboard</a>
				<a class="nav-item" class:active={isActive('/admin/zprojects')} href="/admin/zprojects">Projects</a>
				<a class="nav-item" class:active={isActive('/admin/approvals')} href="/admin/approvals">Approvals</a>
				<a class="nav-item" class:active={isActive('/admin/comms')} href="/admin/comms">Comms</a>
				<a class="nav-item" class:active={isActive('/admin/daily-logs')} href="/admin/daily-logs">Logs</a>

				<div class="nav-more-wrap">
					<button class="nav-item nav-more-btn" type="button" on:click={() => (drawerOpen = !drawerOpen)}>
						More
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5.5l4 4 4-4"/></svg>
					</button>
				</div>

				<a class="nav-item nav-logout" href="/admin/logout">Log out</a>
			</nav>
		</div>
	</header>

	<!-- Slide-out drawer for all nav items -->
	<nav class="drawer" class:open={drawerOpen} aria-label="Admin navigation">
		{#each navGroups as group, gi}
			{#if gi > 0}
				<div class="drawer-divider"></div>
			{/if}
			<div class="drawer-group-label">{group.label}</div>
			<div class="drawer-section">
				{#each group.items as item}
					<a class="drawer-item" class:active={isActive(item.href)} href={item.href}>
						{item.label}
					</a>
				{/each}
			</div>
		{/each}
		<div class="drawer-divider"></div>
		<div class="drawer-section">
			<a class="drawer-item drawer-logout" href="/admin/logout">Log out</a>
		</div>
	</nav>

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

	/* ── Hamburger ──────────────────────────────────── */
	.hamburger {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: none;
		background: transparent;
		color: #374151;
		cursor: pointer;
		border-radius: 10px;
		-webkit-tap-highlight-color: transparent;
	}

	.hamburger:hover {
		background: #f3f4f6;
	}

	/* ── Desktop nav ─────────────────────────────────── */
	.admin-nav-desktop {
		display: none;
		align-items: center;
		gap: 0.2rem;
	}

	.nav-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem;
		border-radius: 8px;
		text-decoration: none;
		color: #4b5563;
		font-size: 0.875rem;
		font-weight: 500;
		transition: background 0.15s, color 0.15s;
		min-height: 36px;
		border: none;
		background: none;
		cursor: pointer;
	}

	.nav-item:hover {
		background: #f3f4f6;
		color: #111827;
	}

	.nav-item.active {
		background: #f0f0f0;
		color: #111827;
		font-weight: 600;
	}

	.nav-logout {
		color: #9ca3af;
	}

	.nav-more-wrap {
		position: relative;
	}

	.nav-more-btn {
		font-family: inherit;
		font-size: 0.875rem;
	}

	/* ── Drawer ──────────────────────────────────────── */
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgba(0, 0, 0, 0.3);
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.drawer {
		position: fixed;
		top: 56px;
		right: 0;
		bottom: 0;
		width: 280px;
		max-width: 85vw;
		z-index: 95;
		background: #fff;
		border-left: 1px solid #e5e7eb;
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
		transform: translateX(100%);
		transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 0.5rem 0;
		display: flex;
		flex-direction: column;
	}

	.drawer.open {
		transform: translateX(0);
	}

	.drawer-group-label {
		padding: 0.5rem 1.5rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9ca3af;
	}

	.drawer-section {
		display: flex;
		flex-direction: column;
		padding: 0 0.5rem;
	}

	.drawer-divider {
		height: 1px;
		background: #e5e7eb;
		margin: 0.35rem 1rem;
	}

	.drawer-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 1rem;
		border-radius: 10px;
		text-decoration: none;
		color: #374151;
		font-size: 0.9rem;
		font-weight: 500;
		min-height: 44px;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s;
	}

	.drawer-item:hover {
		background: #f3f4f6;
	}

	.drawer-item.active {
		background: #f0f0f0;
		color: #111827;
		font-weight: 600;
	}

	.drawer-logout {
		color: #9ca3af;
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

	/* ── Desktop breakpoint ──────────────────────────── */
	@media (min-width: 768px) {
		.admin-header-inner {
			padding: 0 2rem;
		}

		.admin-nav-desktop {
			display: flex;
		}

		.hamburger {
			display: none;
		}

		.admin-footer-inner {
			padding: 1rem 2rem;
		}
	}
</style>
