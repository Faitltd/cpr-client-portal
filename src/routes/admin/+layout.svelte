<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';

	const year = new Date().getFullYear();
	$: pathname = $page.url.pathname;
	$: if (pathname) drawerOpen = false;

	let drawerOpen = false;

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && drawerOpen) {
			drawerOpen = false;
		}
	};

	onMount(() => {
		if (browser) {
			window.addEventListener('keydown', handleKeydown);
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('keydown', handleKeydown);
		}
	});

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
				aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
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
		</div>
	</header>

	<!-- Slide-out drawer for all nav items -->
	<nav class="drawer" class:open={drawerOpen} aria-label="Admin navigation">
		<div class="drawer-close-row">
			<button class="drawer-close" type="button" aria-label="Close menu" on:click={() => (drawerOpen = false)}>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="5" y1="5" x2="15" y2="15" />
					<line x1="5" y1="15" x2="15" y2="5" />
				</svg>
			</button>
		</div>
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

	/* ── Drawer close button ────────────────────────── */
	.drawer-close-row {
		display: flex;
		justify-content: flex-end;
		padding: 0 0.5rem 0.25rem;
	}

	.drawer-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		border-radius: 10px;
		-webkit-tap-highlight-color: transparent;
	}

	.drawer-close:hover {
		background: #f3f4f6;
		color: #374151;
	}

	/* ── Desktop breakpoint ──────────────────────────── */
	@media (min-width: 768px) {
		.admin-header-inner {
			padding: 0 2rem;
		}

		.admin-footer-inner {
			padding: 1rem 2rem;
		}
	}
</style>
