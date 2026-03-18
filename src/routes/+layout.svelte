<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';

	$: pathname = $page.url.pathname;
	$: showClientNav =
		pathname !== '/' &&
		!pathname.startsWith('/admin') &&
		!pathname.startsWith('/auth');
	$: isTradePortal = pathname.startsWith('/trade');
	$: hasPortalSession = Boolean($page.data?.hasPortalSession);
	$: hasTradeSession = Boolean($page.data?.hasTradeSession);
	$: accountHref = isTradePortal ? '/trade/account' : '/account';

	let appBg: HTMLDivElement | null = null;
	let cleanupFade: (() => void) | null = null;

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
		<header class="portal-header">
			<div class="portal-header-inner">
				<a class="portal-logo" href={isTradePortal ? '/trade/dashboard' : '/dashboard'}>
					<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
						<rect width="28" height="28" rx="6" fill="#111827"/>
						<text x="14" y="19" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="system-ui">C</text>
					</svg>
					<span>CPR</span>
				</a>

				{#if isTradePortal && hasTradeSession}
					<nav class="trade-nav" aria-label="Trade navigation">
						<a class="trade-nav-item" class:active={isActive(accountHref, pathname)} href={accountHref}>Account</a>
						<a class="trade-nav-item trade-nav-logout" href="/api/logout?next=/">Log out</a>
					</nav>
				{:else}
					<nav class="client-nav" aria-label="Client navigation">
						{#if hasPortalSession}
							<a class="client-nav-item" class:active={isActive('/dashboard', pathname)} href="/dashboard">Finances</a>
							<a class="client-nav-item" class:active={isActive('/zprojects', pathname)} href="/zprojects">Project</a>
							<a class="client-nav-item" class:active={isActive('/decisions', pathname)} href="/decisions">Decisions</a>
						{/if}
						<a class="client-nav-item" class:active={isActive(accountHref, pathname)} href={accountHref}>Account</a>
						<a class="client-nav-item client-nav-logout" href="/api/logout?next=/">Log out</a>
					</nav>
				{/if}
			</div>
		</header>
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

	/* ── Trade portal inline nav ───────────────────────── */
	.trade-nav {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.trade-nav-item {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 8px;
		text-decoration: none;
		color: #374151;
		font-size: 0.9rem;
		font-weight: 500;
		min-height: 40px;
		white-space: nowrap;
		transition: background 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.trade-nav-item:hover {
		background: #f3f4f6;
	}

	.trade-nav-item.active {
		background: #f0f0f0;
		color: #111827;
		font-weight: 600;
	}

	.trade-nav-logout {
		color: #9ca3af;
	}

	/* ── Client inline nav ──────────────────────────────── */
	.client-nav {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.client-nav-item {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 8px;
		text-decoration: none;
		color: #374151;
		font-size: 0.9rem;
		font-weight: 500;
		min-height: 40px;
		white-space: nowrap;
		transition: background 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.client-nav-item:hover {
		background: #f3f4f6;
	}

	.client-nav-item.active {
		background: #f0f0f0;
		color: #111827;
		font-weight: 600;
	}

	.client-nav-logout {
		color: #9ca3af;
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
