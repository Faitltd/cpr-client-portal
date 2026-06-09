<script lang="ts">
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';

	export let data: LayoutData;

	const TITLES: Record<string, string> = {
		'/designer': 'Active Deals',
		'/designer/projects': 'Project Created',
		'/designer/on-hold': 'On Hold',
		'/designer/chat': 'CPR Bot'
	};

	$: pathname = $page.url.pathname;
	$: title = TITLES[pathname] ?? 'Designer';
	$: designerLabel = data.designer?.name ?? data.designer?.email ?? 'Designer';
</script>

<header class="designer-bar">
	<div class="bar-inner">
		<div class="bar-head">
			<h1>{title}</h1>
			<p class="muted">
				Signed in as <strong>{designerLabel}</strong> · <a href="/api/logout">Sign out</a>
			</p>
		</div>
		<nav class="tabs" aria-label="Designer views">
			<a class="tab" class:active={pathname === '/designer'} href="/designer">Active Deals</a>
			<a class="tab" class:active={pathname === '/designer/projects'} href="/designer/projects"
				>Project Created</a
			>
			<a class="tab" class:active={pathname === '/designer/on-hold'} href="/designer/on-hold"
				>On Hold</a
			>
			{#if data.canChat}
				<a class="tab" class:active={pathname === '/designer/chat'} href="/designer/chat">CPR Bot</a>
			{/if}
		</nav>
	</div>
</header>

<div class="designer-content">
	<slot />
</div>

<style>
	.designer-bar {
		position: sticky;
		top: 56px;
		z-index: 30;
		background: #ffffff;
	}

	.bar-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.25rem 1rem 0;
	}

	.bar-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #0f172a;
	}

	.muted {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.tab {
		padding: 0.55rem 0.95rem;
		color: #6b7280;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}

	.tab:hover {
		color: #111827;
	}

	.tab.active {
		color: #0f172a;
		border-bottom-color: #b45309;
	}

	.designer-content {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}
</style>
