<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';

	$: pathname = $page.url.pathname;
	$: showClientNav =
		pathname !== '/' &&
		!pathname.startsWith('/admin') &&
		!pathname.startsWith('/auth');
	$: isTradePortal = pathname.startsWith('/trade');
	$: hasPortalSession = Boolean($page.data?.hasPortalSession);
	$: hasTradeSession = Boolean($page.data?.hasTradeSession);
	$: accountHref = isTradePortal ? '/trade/account' : '/account';
	$: if (pathname) drawerOpen = false;

	let appBg: HTMLDivElement | null = null;
	let cleanupFade: (() => void) | null = null;
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

	const startFade = () => {
		if (!appBg || !browser) return () => {};

		let raf = 0;
		const update = () => {
			if (!appBg) return;
			const progress = Math.min(1, window.scrollY / 700);
			const opacity = 0.78 + 0.18 * progress;
			appBg.style.setProperty('--bg-fade', opacity.toFixed(3));
		};

		const onScroll = () => {
			if (raf) return;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				update();
			});
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', update);
		update();

		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', update);
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
		};
	};

	$: if (browser && appBg) {
		cleanupFade?.();
		cleanupFade = startFade();
	}

	onDestroy(() => {
		cleanupFade?.();
		if (browser) {
			window.removeEventListener('keydown', handleKeydown);
		}
	});

	const isActive = (href: string, current: string) => {
		if (href === '/trade/projects' && current.startsWith('/trade/projects')) return true;
		if (href === '/dashboard' && current === '/dashboard') return true;
		if (href === '/zprojects' && current.startsWith('/zprojects')) return true;
		return current === href;
	};
</script>

<div class="app-bg" bind:this={appBg}>
	{#if showClientNav}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		{#if drawerOpen}
			<div class="drawer-backdrop" on:click={() => (drawerOpen = false)} role="presentation"></div>
		{/if}
		<header class="portal-header">
			<div class="portal-header-inner">
				<a class="portal-logo" href={isTradePortal ? '/trade/dashboard' : '/dashboard'}>
					<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
						<rect width="28" height="28" rx="6" fill="#111827"/>
						<text x="14" y="19" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="system-ui">C</text>
					</svg>
					<span>CPR</span>
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

		<nav class="drawer" class:open={drawerOpen} aria-label="Main navigation">
			<div class="drawer-close-row">
				<button class="drawer-close" type="button" aria-label="Close menu" on:click={() => (drawerOpen = false)}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<line x1="5" y1="5" x2="15" y2="15" />
						<line x1="5" y1="15" x2="15" y2="5" />
					</svg>
				</button>
			</div>
			<div class="drawer-section">
				{#if hasPortalSession && !isTradePortal}
					<a class="drawer-item" class:active={isActive('/dashboard', pathname)} href="/dashboard">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="16" height="16" rx="3"/><path d="M2 8h16"/><path d="M8 8v10"/></svg>
						Finances
					</a>
					<a class="drawer-item" class:active={isActive('/zprojects', pathname)} href="/zprojects">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h14M3 8h10M3 12h12M3 16h8"/></svg>
						Project
					</a>
					<a class="drawer-item" class:active={isActive('/decisions', pathname)} href="/decisions">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2v6l4 2"/><circle cx="10" cy="10" r="8"/></svg>
						Decisions
					</a>
				{/if}
				{#if isTradePortal && hasTradeSession}
					<a class="drawer-item" class:active={isActive('/trade/dashboard', pathname)} href="/trade/dashboard">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="16" height="16" rx="3"/><path d="M2 8h16"/><path d="M8 8v10"/></svg>
						Dashboard
					</a>
					<a class="drawer-item" class:active={isActive('/trade/projects', pathname)} href="/trade/projects">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h14M3 8h10M3 12h12M3 16h8"/></svg>
						Projects
					</a>
					<a class="drawer-item" class:active={isActive('/trade/daily-log', pathname)} href="/trade/daily-log">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 6h6M7 10h6M7 14h4"/></svg>
						Daily Log
					</a>
					<a class="drawer-item" class:active={isActive('/trade/photos', pathname)} href="/trade/photos">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="2"/><path d="M18 14l-4-4-3 3-2-2-5 5"/></svg>
						Photos
					</a>
					<a class="drawer-item" class:active={isActive('/trade/report-issue', pathname)} href="/trade/report-issue">
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2l8 16H2L10 2z"/><path d="M10 8v4"/><circle cx="10" cy="14" r="0.5" fill="currentColor"/></svg>
						Report Issue
					</a>
				{/if}
			</div>
			<div class="drawer-divider"></div>
			<div class="drawer-section">
				<a class="drawer-item" class:active={isActive(accountHref, pathname)} href={accountHref}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="7" r="4"/><path d="M3 18c0-3.3 3.1-6 7-6s7 2.7 7 6"/></svg>
					Account
				</a>
				<a class="drawer-item drawer-logout" href="/api/logout?next=/">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3M13 14l4-4-4-4M17 10H7"/></svg>
					Log out
				</a>
			</div>
		</nav>
	{/if}
	<div class="app-content">
		<slot />
	</div>
</div>

<style>
	.app-bg {
		position: relative;
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		--bg-fade: 0.78;
		background: url('/images/cpr-bg.png') center/contain no-repeat;
		background-attachment: scroll;
	}

	.app-bg::before {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, var(--bg-fade));
	}

	.app-content {
		position: relative;
		z-index: 1;
	}

	/* ── Header ─────────────────────────────────────────── */
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
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
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

	/* ── Hamburger ──────────────────────────────────────── */
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

	/* ── Drawer ─────────────────────────────────────────── */
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
		padding: 0.75rem 0;
		display: flex;
		flex-direction: column;
	}

	.drawer.open {
		transform: translateX(0);
	}

	.drawer-section {
		display: flex;
		flex-direction: column;
		padding: 0 0.5rem;
	}

	.drawer-divider {
		height: 1px;
		background: #e5e7eb;
		margin: 0.5rem 1rem;
	}

	.drawer-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		text-decoration: none;
		color: #374151;
		font-size: 0.95rem;
		font-weight: 500;
		min-height: 48px;
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

	.drawer-item svg {
		flex-shrink: 0;
		color: #6b7280;
	}

	.drawer-item.active svg {
		color: #111827;
	}

	.drawer-logout {
		color: #9ca3af;
	}

	.drawer-logout svg {
		color: #9ca3af;
	}

	/* ── Drawer close button ───────────────────────────── */
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

	/* ── Global form resets ─────────────────────────────── */
	:global(input),
	:global(select),
	:global(textarea) {
		width: 100%;
		box-sizing: border-box;
	}

	/* ── Desktop breakpoint ─────────────────────────────── */
	@media (min-width: 768px) {
		.portal-header-inner {
			padding: 0 2rem;
		}
	}
</style>
