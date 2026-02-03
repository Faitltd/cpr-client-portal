<script lang="ts">
	import { page } from '$app/stores';

	$: pathname = $page.url.pathname;
	$: showClientNav =
		pathname !== '/' &&
		!pathname.startsWith('/admin') &&
		!pathname.startsWith('/auth');
</script>

<div class="app-bg">
	{#if showClientNav}
		<header class="portal-header">
			<div class="portal-header-inner">
				<a class="portal-logo" href="/dashboard">CPR Portal</a>
				<div class="portal-actions">
					<a class="portal-link" href="/account">Account</a>
					<a class="portal-link" href="/api/logout">Log out</a>
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
		background: url('/images/cpr-logo.png') center/contain no-repeat fixed;
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
</style>
