<script lang="ts">
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';

	export let data: LayoutData;

	$: pathname = $page.url.pathname;

	// Role-dependent destinations. Dedupes Schedule / Assistant, which used to
	// appear in both the designer row and the admin row.
	$: scheduleHref = data.isAdmin ? '/admin/schedule' : '/designer/schedule';
	$: assistantHref = data.isAdmin ? '/admin/bot' : '/designer/chat';

	type Child = { label: string; href: string; match?: () => boolean };
	type Group = { id: string; label: string; children: Child[] };

	// Top row = groups. Second row = children of the active group.
	$: groups = [
		{
			id: 'pipeline',
			label: 'Pipeline',
			children: [
				{ label: 'CRM', href: '/designer', match: () => pathname === '/designer' },
				{ label: 'Pipeline', href: '/designer/team-pipeline' },
				data.tabs.tasks && { label: 'Tasks', href: '/designer/tasks' },
				// Previously not surfaced in the bar. Delete these two if unwanted:
				{ label: 'On-Hold', href: '/designer/on-hold' },
				{ label: 'Projects', href: '/designer/projects' }
			].filter(Boolean) as Child[]
		},
		{
			id: 'field',
			label: 'Field',
			children: [
				data.tabs.fieldDashboard && { label: 'Field Dashboard', href: '/designer/trade-dashboard' },
				data.tabs.fieldUpdate && { label: 'Field Update', href: '/designer/field-update' },
				(data.isAdmin || data.tabs.schedule) && { label: 'Schedule', href: scheduleHref }
			].filter(Boolean) as Child[]
		},
		{
			id: 'design',
			label: 'Design',
			children: [
				{ label: 'Mood Board', href: '/designer/moodboard' },
				data.tabs.cadConverter && { label: 'CAD Converter', href: '/designer/cad-converter' }
			].filter(Boolean) as Child[]
		},
		{
			id: 'money',
			label: 'Money',
			children: [
				data.tabs.finance && { label: 'Finance', href: '/designer/finance' },
				data.tabs.financials && { label: 'Financials', href: '/designer/financials' }
			].filter(Boolean) as Child[]
		},
		{
			id: 'assistant',
			label: 'CPR Assistant',
			children: [
				(data.isAdmin || data.canChat) && { label: 'CPR Assistant', href: assistantHref }
			].filter(Boolean) as Child[]
		},
		{
			id: 'admin',
			label: 'Admin',
			children: data.isAdmin
				? [
						{ label: 'Client Admin', href: '/admin/clients' },
						{ label: 'Leads', href: '/admin/leads' },
						{ label: 'Process Map', href: '/admin/process-map' },
						{
							label: 'Outreach',
							href: '/admin/outreach',
							match: () => pathname.startsWith('/admin/outreach')
						}
					]
				: []
		}
	].filter((g) => g.children.length > 0) as Group[];

	const isChildActive = (c: Child) => (c.match ? c.match() : pathname === c.href);

	$: activeGroup = groups.find((g) => g.children.some(isChildActive)) ?? groups[0];
	$: subtabs = activeGroup && activeGroup.children.length > 1 ? activeGroup.children : [];
</script>

<header class="designer-bar">
	<div class="bar-inner">
		<nav class="tabs" aria-label="Staff views">
			{#each groups as group (group.id)}
				<a
					class="tab"
					class:active={group.id === activeGroup?.id}
					class:tab-admin={group.id === 'admin'}
					href={group.children[0].href}>{group.label}</a
				>
			{/each}
		</nav>

		{#if subtabs.length}
			<nav class="subtabs" aria-label="Section views">
				{#each subtabs as child (child.href)}
					<a class="subtab" class:active={isChildActive(child)} href={child.href}>{child.label}</a>
				{/each}
			</nav>
		{/if}
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

	/* Admin group sits at the far right, amber outline, like before. */
	.tab-admin {
		margin-left: auto;
		border-color: #b45309;
		color: #92400e;
	}

	.tab-admin:hover {
		background: #fff7ed;
		color: #7c2d12;
	}

	.tab-admin.active {
		background: #111827;
		color: #ffffff;
		border-color: #111827;
	}

	/* Contextual second row: light underline tabs for the active group. */
	.subtabs {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		padding: 0.6rem 0.6rem 0.1rem;
	}

	.subtab {
		padding: 0.35rem 0.1rem;
		color: #64748b;
		font-weight: 600;
		font-size: 0.85rem;
		text-decoration: none;
		border-bottom: 2px solid transparent;
		transition: color 0.15s ease, border-color 0.15s ease;
	}

	.subtab:hover {
		color: #0f172a;
	}

	.subtab.active {
		color: #111827;
		border-bottom-color: #111827;
	}

	.designer-content {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}
</style>
