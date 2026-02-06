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
	$: accountHref = isTradePortal ? '/trade/account' : '/account';
	$: isLoginPage = pathname.startsWith('/auth') || pathname === '/admin/login';

	let appBg: HTMLDivElement | null = null;
	let cleanupParallax: (() => void) | null = null;

	const startParallax = () => {
		if (!appBg || !browser) return () => {};

		let raf = 0;
		const update = () => {
			if (!appBg) return;
			const offset = Math.min(80, window.scrollY * 0.08);
			appBg.style.setProperty('--parallax-offset', `${offset}px`);
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
		cleanupParallax?.();
		if (!isLoginPage) {
			cleanupParallax = startParallax();
		} else {
			appBg.style.setProperty('--parallax-offset', '0px');
			cleanupParallax = null;
		}
	}

	onDestroy(() => cleanupParallax?.());
</script>

<div class="app-bg" class:parallax-enabled={!isLoginPage} bind:this={appBg}>
	{#if showClientNav}
		<header class="portal-header">
			<div class="portal-header-inner">
				<a class="portal-logo" href="/api/logout?next=/">CPR Portal</a>
				<div class="portal-actions">
					<a class="portal-link" href={accountHref}>Account</a>
					<a class="portal-link" href="/api/logout?next=/">Log out</a>
				</div>
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
		font-family: Helvetica, Arial, sans-serif;
		--parallax-offset: 0px;
		background: url('/images/cpr-logo.png') center/contain no-repeat;
		background-attachment: scroll;
		background-position: center;
	}

	.app-bg.parallax-enabled {
		background-attachment: fixed;
		background-position: center calc(50% + var(--parallax-offset));
	}

	.app-bg::before {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, 0.78);
	}

	.app-content {
		position: relative;
		z-index: 1;
	}

	.portal-header {
		position: sticky;
		top: 0;
		z-index: 2;
		background: rgba(255, 255, 255, 0.92);
		border-bottom: 1px solid #e5e5e5;
		backdrop-filter: blur(6px);
	}

	.portal-header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 2rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.portal-logo {
		font-weight: 700;
		text-decoration: none;
		color: #111827;
	}

	.portal-actions {
		display: flex;
		gap: 0.6rem;
	}

	.portal-link {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.9rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		text-decoration: none;
		color: #1a1a1a;
		background: #fff;
	}
	.portal-link:hover {
		background: #f3f4f6;
	}

	:global(input),
	:global(select),
	:global(textarea) {
		width: 100%;
		box-sizing: border-box;
	}
</style>
