<script lang="ts">
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';

	export let data: LayoutData;

	$: pathname = $page.url.pathname;
</script>

<header class="designer-bar">
	<div class="bar-inner">
		<nav class="tabs" aria-label="Designer views">
			{#if data.hasTrade}
				<a
					class="tab"
					class:active={pathname === '/designer/trade-dashboard'}
					href="/designer/trade-dashboard">Field Dashboard</a
				>
				<a
					class="tab"
					class:active={pathname === '/designer/field-update'}
					href="/designer/field-update">Field Update</a
				>
			{/if}
			<a
				class="tab"
				class:active={pathname === '/designer' ||
					pathname === '/designer/projects' ||
					pathname === '/designer/on-hold'}
				href="/designer">CRM</a
			>
			<a class="tab" class:active={pathname === '/designer/tasks'} href="/designer/tasks">Tasks</a>
			<a class="tab" class:active={pathname === '/designer/financials'} href="/designer/financials"
				>Financials</a
			>
			{#if data.canChat}
				<a class="tab" class:active={pathname === '/designer/chat'} href="/designer/chat">CPR Bot</a>
			{/if}
			{#if data.isAdmin}
				<a class="tab tab-admin" href="/admin/clients">Admin</a>
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

	.tab.active {
		background: #111827;
		color: #ffffff;
		border-color: #111827;
	}

	.tab-admin {
		margin-left: auto;
		border-color: #b45309;
		color: #92400e;
	}

	.tab-admin:hover {
		background: #fff7ed;
		color: #7c2d12;
	}

	.designer-content {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}
</style>
