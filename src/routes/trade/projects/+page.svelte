<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const deals = Array.isArray(data?.deals) ? data.deals : [];
	let selectedDealId = deals[0]?.id || '';

	const getDealLabel = (deal: any) => {
		return (
			deal?.Deal_Name ||
			deal?.Potential_Name ||
			deal?.Name ||
			deal?.name ||
			deal?.Subject ||
			deal?.Full_Name ||
			deal?.Display_Name ||
			deal?.display_name ||
			(deal?.id ? `Deal ${String(deal.id).slice(-6)}` : 'Untitled Deal')
		);
	};

	type TradeProject = any;

	const CACHE_KEY = 'cpr:trade:projects:list';

	let projects: TradeProject[] = [];
	let loading = true;
	let refreshing = false;
	let error = '';

	const formatDate = (value: any) => {
		if (!value) return '—';
		const raw = String(value).trim();
		const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (dateOnly) {
			const [, y, m, d] = dateOnly;
			const local = new Date(Number(y), Number(m) - 1, Number(d));
			return local.toLocaleDateString();
		}
		const parsed = new Date(raw);
		return Number.isNaN(parsed.valueOf()) ? raw : parsed.toLocaleDateString();
	};

	const getHref = (project: any) => {
		const id = project?.id;
		if (!id) return '/trade/projects';
		return `/trade/projects/${encodeURIComponent(id)}`;
	};

	const getProgressPhotosHref = (project: any) => {
		const dealId = String(project?.deal_id || '').trim();
		if (dealId) return `/api/trade/deals/${encodeURIComponent(dealId)}/progress-photos`;
		return '/trade/photos';
	};

	const getName = (project: any) =>
		project?.name ?? project?.Deal_Name ?? project?.Project_Name ?? 'Untitled Project';

	const getStatus = (project: any) => {
		const candidate = project?.status ?? project?.Stage ?? null;
		if (typeof candidate === 'string') return candidate;
		if (candidate && typeof candidate === 'object') {
			const name = candidate?.name ?? candidate?.display_value ?? null;
			if (typeof name === 'string' && name.trim()) return name.trim();
		}
		return 'Unknown';
	};

	const getSubtitle = (project: any) => {
		const parts: string[] = [];
		if (project?.address) parts.push(project.address);
		const cityState = [project?.city, project?.state].filter(Boolean).join(', ');
		if (cityState) parts.push(cityState);
		return parts.join(', ');
	};

	function loadFromCache(): boolean {
		try {
			const raw = sessionStorage.getItem(CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw);
			if (Array.isArray(cached?.projects) && cached.projects.length > 0) {
				projects = cached.projects;
				return true;
			}
		} catch {
			/* ignore corrupt cache */
		}
		return false;
	}

	function saveToCache(data: TradeProject[]) {
		try {
			sessionStorage.setItem(CACHE_KEY, JSON.stringify({ projects: data, ts: Date.now() }));
		} catch {
			/* storage full or unavailable */
		}
	}

	async function fetchProjects(isRefresh: boolean) {
		if (isRefresh) refreshing = true;
		try {
			const res = await fetch('/api/trade/projects');
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = '/auth/trade';
					return;
				}
				const detail = await res.text().catch(() => '');
				throw new Error(detail || 'Failed to load projects');
			}

			const payload = await res.json().catch(() => ({}));
			const fresh = payload.projects || [];
			projects = fresh;
			saveToCache(fresh);
			error = '';
		} catch (err) {
			if (!isRefresh) {
				error = err instanceof Error ? err.message : 'Unknown error';
			}
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		const hadCache = loadFromCache();
		if (hadCache) {
			loading = false;
			fetchProjects(true);
		} else {
			fetchProjects(false);
		}
	});

	$: filteredProjects =
		selectedDealId === ''
			? projects
			: projects.filter((p) => p.deal_id === selectedDealId || p.id === selectedDealId);

	$: displayProjects = filteredProjects.length > 0 || selectedDealId !== '' ? filteredProjects : projects;
</script>

<div class="trade-projects">
	<header>
		<a class="back" href="/trade/dashboard">← Dashboard</a>
		<div>
			<h1>Projects</h1>
			<p>View your active deals and project assignments.</p>
		</div>
	</header>

	{#if data?.warning}
		<div class="card warning">{data.warning}</div>
	{:else if deals.length === 0}
		<div class="empty">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		<div class="deal-selector card">
			<label for="trade-deal">Select Deal</label>
			<select id="trade-deal" bind:value={selectedDealId}>
				<option value="">All Deals</option>
				{#each deals as deal}
					<option value={deal.id}>
						{getDealLabel(deal)}
					</option>
				{/each}
			</select>
		</div>

		{#if loading}
			<div class="loading">Loading your projects...</div>
		{:else if error}
			<div class="error">
				<p>Error: {error}</p>
				<button class="retry" type="button" on:click={() => fetchProjects(false)}>Retry</button>
			</div>
		{:else if displayProjects.length === 0}
			<div class="empty">
				<p>No active projects{selectedDealId ? ' for this deal' : ''}</p>
			</div>
		{:else}
			{#if refreshing}
				<div class="refreshing">Updating...</div>
			{/if}
			<section class="projects-section">
				<div class="projects-grid">
					{#each displayProjects as project}
						<article class="project-card">
							<div class="project-info">
								<h3>{getName(project)}</h3>
								<p class="status">Status: {getStatus(project)}</p>
								{#if getSubtitle(project)}
									<p class="subtitle">{getSubtitle(project)}</p>
								{/if}
								<p class="date">Closing: {formatDate(project?.end_date ?? project?.Closing_Date)}</p>
							</div>
							<div class="project-actions">
								<a class="btn-secondary" href={getProgressPhotosHref(project)}>
									Progress Photos
								</a>
								<a class="btn-view" href={getHref(project)}>View Details</a>
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.trade-projects {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.back {
		display: inline-block;
		margin-bottom: 1rem;
		color: #6b7280;
		text-decoration: none;
		font-size: 0.95rem;
	}

	.back:hover {
		color: #111827;
	}

	h1 {
		margin: 0 0 0.5rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.warning {
		border-color: #f59e0b;
		background: #fffbeb;
		color: #92400e;
		margin-bottom: 1.5rem;
	}

	.deal-selector {
		margin-bottom: 1.5rem;
		display: grid;
		gap: 0.5rem;
	}

	select {
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 1rem;
		width: 100%;
		min-height: 44px;
	}

	.loading {
		padding: 2rem;
		text-align: center;
		color: #666;
	}

	.refreshing {
		padding: 0.4rem 0.75rem;
		margin-bottom: 0.75rem;
		font-size: 0.88rem;
		color: #6b7280;
		text-align: center;
	}

	.error {
		padding: 2rem;
		border: 1px solid #fecaca;
		background: #fff5f5;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.error p {
		margin: 0;
		color: #b91c1c;
	}

	.retry {
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
		border-radius: 10px;
		padding: 0.55rem 0.85rem;
		font-weight: 800;
		min-height: 40px;
		cursor: pointer;
	}

	.retry:hover {
		background: #f3f4f6;
	}

	.empty {
		padding: 2rem;
		border: 1px dashed #d1d5db;
		border-radius: 10px;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	.projects-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.25rem;
	}

	.project-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #fff;
		min-height: 160px;
	}

	.project-card:hover {
		border-color: #cbd5e1;
		box-shadow: 0 10px 22px rgba(0, 0, 0, 0.06);
		transform: translateY(-1px);
		transition: 120ms ease;
	}

	.project-info h3 {
		margin: 0 0 0.5rem;
	}

	.project-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.btn-view,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 42px;
		padding: 0.7rem 1rem;
		border-radius: 10px;
		font-weight: 700;
		text-decoration: none;
	}

	.btn-view {
		background: #0066cc;
		color: #fff;
	}

	.btn-view:hover {
		background: #0052a3;
	}

	.btn-secondary {
		background: #f9fafb;
		color: #111827;
		border: 1px solid #d1d5db;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
		border-color: #cbd5e1;
	}

	.status,
	.subtitle,
	.date {
		margin: 0.25rem 0;
		color: #4b5563;
	}

	@media (max-width: 720px) {
		.trade-projects {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
