<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { formatCrmRichText, decodeHtmlEntities } from '$lib/html';

	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const tradePartner = data?.tradePartner || { email: '' };
	const deals = Array.isArray(data?.deals) ? data.deals : [];
	let selectedDealId = deals[0]?.id || '';

	onMount(() => {
		const paramId = new URLSearchParams(window.location.search).get('deal');
		if (paramId && deals.find((d) => d.id === paramId)) {
			selectedDealId = paramId;
		}
		loadProjectsList();
	});
	$: selectedDeal = deals.find((deal) => deal.id === selectedDealId);

	type FieldUpdate = {
		id: string;
		createdAt: string | null;
		updatedAt: string | null;
		type: string | null;
		body: string | null;
		photos: Array<{ name: string; url: string }>;
	};

	type DesignFile = { name: string; url?: string; attachmentId?: string };

	const safeDecode = (value: string) => {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	};

	const normalizeDesignFiles = (value: any): DesignFile[] => {
		if (!value) return [];

		const toItem = (item: any): DesignFile | null => {
			if (!item) return null;
			if (typeof item === 'string') {
				const name = item.split('/').pop() || 'Design file';
				return { name, url: item };
			}
			if (typeof item === 'object') {
				const attachmentId =
					item.fields_attachment_id ||
					item.fieldsAttachmentId ||
					item.attachment_id ||
					item.attachmentId ||
					item.file_id ||
					item.fileId ||
					item.id ||
					item.ID ||
					'';
				const url =
					item.link_url ||
					item.link ||
					item.download_url ||
					item.url ||
					item.File_Url ||
					item.File_URL ||
					item.file_url ||
					item.fileUrl ||
					item.href ||
					'';
				const name =
					item.file_name ||
					item.File_Name ||
					item.name ||
					item.filename ||
					item.fileName ||
					item.display_name ||
					safeDecode(String(url).split('/').pop() || '') ||
					'Design file';
				if (!url && !attachmentId) return null;
				return { name, url: url || undefined, attachmentId: attachmentId || undefined };
			}
			return null;
		};

		if (Array.isArray(value)) {
			return value.map(toItem).filter(Boolean) as DesignFile[];
		}

		const single = toItem(value);
		return single ? [single] : [];
	};

	const getDesignLink = (file: DesignFile) => {
		if (file.url) return file.url;
		if (!file.attachmentId || !selectedDeal?.id) return '';
		const params = new URLSearchParams();
		if (file.name) params.set('fileName', file.name);
		const suffix = params.toString() ? `?${params.toString()}` : '';
		return `/api/trade/deals/${selectedDeal.id}/fields-attachment/${file.attachmentId}${suffix}`;
	};

	$: designFiles = normalizeDesignFiles(selectedDeal?.File_Upload);

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

	const formatAddress = (deal: any) => {
		const line1 = deal.Address || deal.Street || '';
		const line2 = deal.Address_Line_2 || '';
		const city = deal.City || '';
		const state = deal.State || '';
		const zip = deal.Zip_Code || '';
		const parts = [line1, line2].filter(Boolean);
		const cityStateZip = [city, state].filter(Boolean).join(', ');
		const tail = [cityStateZip, zip].filter(Boolean).join(' ');
		if (tail) parts.push(tail);
		return parts.join(', ');
	};

	const getMapsUrl = (deal: any) => {
		const address = formatAddress(deal);
		if (!address) return '';
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
	};

	const formatUpdateTimestamp = (value: string | null) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return String(value);
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	// ── Project list (for mapping deals → Zoho project IDs) ─────
	const PROJECTS_LIST_CACHE_KEY = 'cpr:trade:projects:list';
	let projectsList: any[] = [];
	let projectsListLoaded = false;
	let pendingTasksDealId: string | null = null;

	const loadProjectsList = async () => {
		try {
			const raw = sessionStorage.getItem(PROJECTS_LIST_CACHE_KEY);
			if (raw) {
				const cached = JSON.parse(raw);
				if (Array.isArray(cached?.projects)) {
					projectsList = cached.projects;
					projectsListLoaded = true;
				}
			}
		} catch { /* ignore */ }

		try {
			const res = await fetch('/api/trade/projects');
			if (res.ok) {
				const payload = await res.json().catch(() => ({}));
				projectsList = payload.projects || [];
				projectsListLoaded = true;
				try { sessionStorage.setItem(PROJECTS_LIST_CACHE_KEY, JSON.stringify({ projects: projectsList, ts: Date.now() })); } catch { /* ignore */ }
			}
		} catch { /* non-fatal */ }

		if (pendingTasksDealId) {
			const id = pendingTasksDealId;
			pendingTasksDealId = null;
			loadTasks(id);
		}
	};

	// ── Tasks ─────────────────────────────────────────────────
	const TASK_STATUSES = [
		{ value: 'not_started', label: 'Not Started' },
		{ value: 'in_progress',  label: 'In Progress'  },
		{ value: 'completed',    label: 'Completed'    }
	];

	// Per-deal raw task cache
	const tasksCache = new Map<string, any[]>();
	let tasks: any[] = [];
	let tasksLoading = false;
	let tasksError = '';
	let lastTasksDealId = '';
	// Track which project ID owns the current tasks (needed for status update URL)
	let selectedProjectId = '';
	let isZohoProject = false; // false = CRM deal only, status updates disabled

	let updatingTaskIds = new Set<string>();
	let taskStatusErrors = new Map<string, string>();

	const getTaskStatus = (task: any): string => {
		const v = task?.status ?? task?.task_status ?? '';
		return typeof v === 'string' ? v : v?.name ?? '';
	};

	const normalizeStatus = (raw: string): string => {
		const s = raw.toLowerCase().replace(/\s+/g, '_');
		if (!s || s === 'open' || s === 'not_started') return 'not_started';
		if (s === 'completed' || s === 'closed' || s === 'done' || s === 'complete') return 'completed';
		return 'in_progress';
	};

	const getTaskStatusValue = (task: any) => normalizeStatus(getTaskStatus(task));

	const getTaskName  = (t: any) => t?.name ?? t?.task_name ?? 'Untitled task';
	const getTaskAssignee = (t: any) =>
		t?.owner?.name ?? t?.assignee?.name ?? t?.person_responsible ?? t?.user_name ?? null;

	$: taskGroups = (() => {
		const groups = new Map<string, any[]>();
		for (const task of tasks) {
			const name =
				task?.tasklist?.name ??
				task?.tasklist_name ??
				task?.tasklist?.task_list_name ??
				'Tasks';
			const list = groups.get(name) ?? [];
			list.push(task);
			groups.set(name, list);
		}
		return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
	})();

	const loadTasks = async (dealId: string) => {
		if (!dealId) return;
		updatingTaskIds = new Set();
		taskStatusErrors = new Map();

		const project = projectsList.find((p: any) => p.deal_id === dealId || p.id === dealId);
		const isCrm = !project || project?.source === 'crm_deal';

		// Only Zoho Projects have tasks — CRM-only deals show nothing
		if (isCrm) {
			tasks = [];
			selectedProjectId = '';
			isZohoProject = false;
			return;
		}

		tasks = tasksCache.get(dealId) ?? [];
		tasksLoading = true;
		tasksError = '';

		const projectId = project.id;

		try {
			const res = await fetch(`/api/trade/projects/${encodeURIComponent(projectId)}`);
			if (res.status === 401) throw new Error('Please login again');
			if (res.status === 403) {
				// The cached project list may have a stale project ID. Wipe the cache,
				// re-fetch the project list, and retry once with the fresh ID.
				try { sessionStorage.removeItem(PROJECTS_LIST_CACHE_KEY); } catch { /* ignore */ }
				const freshRes = await fetch('/api/trade/projects');
				if (freshRes.ok) {
					const freshPayload = await freshRes.json().catch(() => ({}));
					projectsList = freshPayload.projects || [];
					try { sessionStorage.setItem(PROJECTS_LIST_CACHE_KEY, JSON.stringify({ projects: projectsList, ts: Date.now() })); } catch { /* ignore */ }
					const freshProject = projectsList.find((p: any) => p.deal_id === dealId || p.id === dealId);
					const freshProjectId = freshProject?.id;
					if (freshProjectId && freshProjectId !== projectId) {
						// Retry with the updated project ID
						const retryRes = await fetch(`/api/trade/projects/${encodeURIComponent(freshProjectId)}`);
						if (retryRes.ok) {
							const retryPayload = await retryRes.json().catch(() => ({}));
							const fresh: any[] = retryPayload?.tasks ?? [];
							tasksCache.set(dealId, fresh);
							if (dealId === selectedDealId) {
								tasks = fresh;
								selectedProjectId = freshProjectId;
								isZohoProject = true;
								if (fresh.length === 0 && retryPayload?.tasksError) {
									tasksError = `Could not load tasks: ${retryPayload.tasksError}`;
								}
							}
							return;
						}
					}
				}
				throw new Error('Failed to load tasks (403)');
			}
			if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
			const payload = await res.json().catch(() => ({}));
			const fresh: any[] = payload?.tasks ?? [];
			tasksCache.set(dealId, fresh);
			if (dealId === selectedDealId) {
				tasks = fresh;
				selectedProjectId = projectId;
				isZohoProject = true;
				if (fresh.length === 0 && payload?.tasksError) {
					tasksError = `Could not load tasks: ${payload.tasksError}`;
				}
			}
		} catch (err) {
			tasksError = err instanceof Error ? err.message : 'Failed to load tasks';
			if (!tasksCache.has(dealId)) tasks = [];
		} finally {
			tasksLoading = false;
		}
	};

	const updateTaskStatus = async (task: any, newStatus: string) => {
		if (!isZohoProject || !selectedProjectId) return;
		const taskId = String(task?.id || task?.id_string || '');
		if (!taskId) return;

		const prevStatus = task?.status;
		const prevTaskStatus = task?.task_status;

		updatingTaskIds = new Set([...updatingTaskIds, taskId]);
		taskStatusErrors = new Map(taskStatusErrors);
		taskStatusErrors.delete(taskId);

		// Optimistic update
		const label = TASK_STATUSES.find((s) => s.value === newStatus)?.label ?? newStatus;
		task.status = typeof task.status === 'object' ? { ...task.status, name: label } : label;
		tasks = [...tasks];

		try {
			const res = await fetch(
				`/api/trade/projects/${encodeURIComponent(selectedProjectId)}/tasks/${encodeURIComponent(taskId)}/status`,
				{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) }
			);
			if (res.status === 401) { window.location.href = '/auth/trade'; return; }
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || `Failed to update (${res.status})`);
			// Invalidate cache and re-fetch for real state
			tasksCache.delete(selectedDealId);
			await loadTasks(selectedDealId);
		} catch (err) {
			task.status = prevStatus;
			task.task_status = prevTaskStatus;
			tasks = [...tasks];
			taskStatusErrors = new Map(taskStatusErrors);
			taskStatusErrors.set(taskId, err instanceof Error ? err.message : 'Update failed');
		} finally {
			updatingTaskIds = new Set([...updatingTaskIds]);
			updatingTaskIds.delete(taskId);
		}
	};

	$: if (browser && selectedDealId && selectedDealId !== lastTasksDealId) {
		lastTasksDealId = selectedDealId;
		if (projectsListLoaded) {
			loadTasks(selectedDealId);
		} else {
			pendingTasksDealId = selectedDealId;
		}
	}

	// ── Per-deal cache so switching back to a project shows data immediately
	const fieldUpdatesCache = new Map<string, FieldUpdate[]>();

	let fieldUpdates: FieldUpdate[] = [];
	let fieldUpdatesLoading = false;
	let fieldUpdatesError = '';
	let lastFieldUpdatesDealId = '';
	let fieldUpdatesController: AbortController | null = null;

	// Collapsible state — collapsed by default
	let tasksOpen = false;
	let fieldUpdatesOpen = false;
	let photosOpen = false;

	const loadFieldUpdates = async (dealId: string) => {
		if (!dealId) return;
		fieldUpdatesController?.abort();
		fieldUpdatesController = new AbortController();
		// Restore cached data immediately; fetch will update it in the background
		fieldUpdates = fieldUpdatesCache.get(dealId) ?? [];
		fieldUpdatesLoading = true;
		fieldUpdatesError = '';
		let didTimeout = false;
		const timeoutId = setTimeout(() => {
			didTimeout = true;
			fieldUpdatesController?.abort();
		}, 15000);

		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(dealId)}/field-updates`, {
				signal: fieldUpdatesController.signal
			});
			if (res.status === 401) throw new Error('Please login again');
			if (!res.ok) {
				let serverMessage = '';
				try {
					const payload = await res.json().catch(() => ({}));
					serverMessage = String(payload?.message || '').trim();
				} catch {
					// ignore
				}
				if (!serverMessage) {
					serverMessage = (await res.text().catch(() => '')).trim();
				}
				throw new Error(
					serverMessage
						? `${serverMessage} (${res.status})`
						: `Failed to fetch field updates (${res.status})`
				);
			}
			const payload = await res.json().catch(() => ({}));
			const fresh = Array.isArray(payload?.data) ? payload.data : [];
			fieldUpdatesCache.set(dealId, fresh);
			// Only update the display if we're still on the same deal
			if (dealId === selectedDealId) fieldUpdates = fresh;
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				if (didTimeout) {
					fieldUpdatesError = 'Field updates request timed out. Please retry.';
					if (!fieldUpdatesCache.has(dealId)) fieldUpdates = [];
				}
				return;
			}
			fieldUpdatesError = err instanceof Error ? err.message : 'Failed to fetch field updates';
			if (!fieldUpdatesCache.has(dealId)) fieldUpdates = [];
		} finally {
			clearTimeout(timeoutId);
			fieldUpdatesLoading = false;
		}
	};

	$: if (browser && selectedDealId && selectedDealId !== lastFieldUpdatesDealId) {
		lastFieldUpdatesDealId = selectedDealId;
		loadFieldUpdates(selectedDealId);
	}

	// Collect all photos across field updates for the Photos section
	$: allPhotos = fieldUpdates.flatMap((u) =>
		(u.photos || []).map((p) => ({ ...p, updateType: u.type, date: u.createdAt || u.updatedAt }))
	);

	$: fieldUpdateUrl = selectedDealId
		? `/trade/field-update?deal=${encodeURIComponent(selectedDealId)}`
		: '/trade/field-update';

	onDestroy(() => {
		fieldUpdatesController?.abort();
	});
</script>

<div class="dashboard">
	<header class="dash-header">
		<div class="dash-header-text">
			<h1>Dashboard</h1>
			<p class="dash-welcome">{tradePartner.name || tradePartner.email}</p>
		</div>
		<a class="field-update-btn" href={fieldUpdateUrl}>
			<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="3" y="2" width="14" height="16" rx="2"/>
				<path d="M7 6h6M7 10h6M7 14h4"/>
			</svg>
			Submit Field Update
		</a>
	</header>

	{#if data?.warning}
		<div class="card warning">{data.warning}</div>
	{:else if deals.length === 0}
		<div class="card">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		<div class="trade-selector card">
			<label for="trade-deal">Select Project</label>
			<select id="trade-deal" bind:value={selectedDealId}>
				{#each deals as deal}
					<option value={deal.id}>
						{getDealLabel(deal)}
					</option>
				{/each}
			</select>
		</div>

		{#if selectedDeal}
			<div class="card deal-details">
				<h3>{getDealLabel(selectedDeal)}</h3>
				<div class="details-grid">
					<div>
						<h4>Address</h4>
						{#if formatAddress(selectedDeal)}
							<p>
								<a
									class="address-link"
									href={getMapsUrl(selectedDeal)}
									target="_blank"
									rel="noreferrer"
								>
									{formatAddress(selectedDeal)}
								</a>
							</p>
						{:else}
							<p>Not available</p>
						{/if}
					</div>
					<div>
						<h4>Garage Code</h4>
						<p>{selectedDeal.Garage_Code || 'Not available'}</p>
					</div>
					<div>
						<h4>WiFi</h4>
						<p>{selectedDeal.WiFi || 'Not available'}</p>
					</div>
					<div class="notes">
						<h4>Scope</h4>
						<p class="scope-text">{formatCrmRichText(selectedDeal.Refined_SOW) || 'Not available'}</p>
					</div>
					<div class="notes">
						<h4>Designs</h4>
						{#if designFiles.length > 0}
							<ul class="file-list">
								{#each designFiles as file}
									{#if getDesignLink(file)}
										<li>
											<a class="file-link" href={getDesignLink(file)} target="_blank" rel="noreferrer">
												{file.name}
											</a>
										</li>
									{/if}
								{/each}
							</ul>
						{:else}
							<p>Not available</p>
						{/if}
					</div>
				</div>
			</div>

			<!-- Tasks collapsible -->
			<div class="card collapsible-card">
				<button
					class="collapsible-toggle"
					type="button"
					on:click={() => (tasksOpen = !tasksOpen)}
					aria-expanded={tasksOpen}
				>
					<span class="collapsible-title">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<path d="M4 5h12M4 10h8M4 15h10"/>
							<circle cx="17" cy="10" r="3"/>
						</svg>
						Tasks
						{#if !tasksLoading && tasks.length > 0}
							<span class="count-badge">{tasks.length}</span>
						{/if}
					</span>
					<svg class="chevron" class:rotated={tasksOpen} width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
						<path d="M5 8l5 5 5-5"/>
					</svg>
				</button>

				{#if tasksOpen}
					<div class="collapsible-body">
						{#if tasksLoading && tasks.length === 0}
							<p class="muted">Loading tasks...</p>
						{:else if tasksError && tasks.length === 0}
							<div class="field-updates-error">
								<p class="error-text">{tasksError}</p>
								<button class="retry" type="button" on:click={() => loadTasks(selectedDealId)}>Retry</button>
							</div>
						{:else if tasks.length === 0}
							<p class="muted">No tasks found for this project.</p>
						{:else}
							{#each taskGroups as group}
								{#if taskGroups.length > 1}
									<p class="task-group-name">{group.name}</p>
								{/if}
								<div class="task-list">
									{#each group.items as task}
										{@const tid = String(task?.id || task?.id_string || '')}
										<div class="task-row">
											<div class="task-info">
												<p class="task-name">{decodeHtmlEntities(getTaskName(task))}</p>
												{#if getTaskAssignee(task)}
													<p class="task-assignee">{getTaskAssignee(task)}</p>
												{/if}
												{#if taskStatusErrors.has(tid)}
													<p class="task-error">{taskStatusErrors.get(tid)}</p>
												{/if}
											</div>
											{#if isZohoProject}
												<select
													class="task-status-select task-status-{getTaskStatusValue(task)}"
													value={getTaskStatusValue(task)}
													disabled={updatingTaskIds.has(tid)}
													on:change={(e) => updateTaskStatus(task, e.currentTarget.value)}
												>
													{#each TASK_STATUSES as opt}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
											{:else}
												<span class="task-status-badge task-status-{getTaskStatusValue(task)}">
													{TASK_STATUSES.find(s => s.value === getTaskStatusValue(task))?.label ?? getTaskStatus(task)}
												</span>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Field Updates collapsible -->
			<div class="card collapsible-card">
				<button
					class="collapsible-toggle"
					type="button"
					on:click={() => (fieldUpdatesOpen = !fieldUpdatesOpen)}
					aria-expanded={fieldUpdatesOpen}
				>
					<span class="collapsible-title">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<rect x="3" y="2" width="14" height="16" rx="2"/>
							<path d="M7 6h6M7 10h6M7 14h4"/>
						</svg>
						Field Updates
						{#if !fieldUpdatesLoading && fieldUpdates.length > 0}
							<span class="count-badge">{fieldUpdates.length}</span>
						{/if}
					</span>
					<svg
						class="chevron"
						class:rotated={fieldUpdatesOpen}
						width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M5 8l5 5 5-5"/>
					</svg>
				</button>

				{#if fieldUpdatesOpen}
					<div class="collapsible-body">
						{#if fieldUpdatesLoading}
							<p class="muted">Loading field updates...</p>
						{:else if fieldUpdatesError}
							<div class="field-updates-error">
								<p class="error-text">{fieldUpdatesError}</p>
								<button class="retry" type="button" on:click={() => loadFieldUpdates(selectedDealId)}>
									Retry
								</button>
							</div>
						{:else if fieldUpdates.length === 0}
							<p class="muted">No field updates submitted for this project yet.</p>
						{:else}
							<div class="updates">
								{#each fieldUpdates as update (update.id)}
									<article class="update">
										<div class="update-meta">
											{#if update.type}
												<span class="badge">{update.type}</span>
											{/if}
											<span class="update-date">
												{formatUpdateTimestamp(update.createdAt || update.updatedAt)}
											</span>
										</div>

										{#if update.body}
											<p class="update-body">{update.body}</p>
										{/if}

										{#if update.photos?.length}
											<div class="update-photos">
												{#each update.photos as photo (photo.url)}
													<a class="photo" href={photo.url} target="_blank" rel="noreferrer">
														<img src={photo.url} alt={photo.name} loading="lazy" />
													</a>
												{/each}
											</div>
										{/if}
									</article>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Photos collapsible -->
			<div class="card collapsible-card">
				<button
					class="collapsible-toggle"
					type="button"
					on:click={() => (photosOpen = !photosOpen)}
					aria-expanded={photosOpen}
				>
					<span class="collapsible-title">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<rect x="2" y="3" width="16" height="14" rx="2"/>
							<circle cx="7" cy="8" r="2"/>
							<path d="M18 14l-4-4-3 3-2-2-5 5"/>
						</svg>
						Photos
						{#if !fieldUpdatesLoading && allPhotos.length > 0}
							<span class="count-badge">{allPhotos.length}</span>
						{/if}
					</span>
					<svg
						class="chevron"
						class:rotated={photosOpen}
						width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M5 8l5 5 5-5"/>
					</svg>
				</button>

				{#if photosOpen}
					<div class="collapsible-body">
						{#if fieldUpdatesLoading}
							<p class="muted">Loading photos...</p>
						{:else if allPhotos.length === 0}
							<p class="muted">No photos submitted for this project yet.</p>
						{:else}
							<div class="photos-grid">
								{#each allPhotos as photo (photo.url)}
									<a class="photo" href={photo.url} target="_blank" rel="noreferrer">
										<img src={photo.url} alt={photo.name} loading="lazy" />
									</a>
								{/each}
							</div>
						{/if}
						<a class="view-all-photos" href="/trade/photos">
							View all photos
							<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
								<path d="M5 10h10M11 6l4 4-4 4"/>
							</svg>
						</a>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.25rem;
	}

	.dash-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.dash-header-text h1 {
		margin: 0 0 0.15rem;
		font-size: 1.5rem;
	}

	.dash-welcome {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.field-update-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: #111827;
		color: #fff;
		text-decoration: none;
		font-weight: 700;
		font-size: 0.95rem;
		padding: 0.65rem 1.1rem;
		border-radius: 10px;
		min-height: 44px;
		white-space: nowrap;
		transition: background 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.field-update-btn:hover {
		background: #1f2937;
	}

	.card {
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem;
		background: #fff;
		margin-bottom: 1rem;
	}

	.warning {
		border-color: #f59e0b;
		background: #fffbeb;
		color: #92400e;
	}

	.trade-selector {
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

	.deal-details h3 {
		margin-top: 0;
		margin-bottom: 0;
	}

	/* Collapsible cards */
	.collapsible-card {
		padding: 0;
		overflow: hidden;
	}

	.collapsible-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		background: none;
		border: none;
		padding: 1.1rem 1.25rem;
		cursor: pointer;
		text-align: left;
		-webkit-tap-highlight-color: transparent;
		border-radius: 12px;
	}

	.collapsible-toggle:hover {
		background: #f9fafb;
	}

	.collapsible-title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		font-weight: 700;
		color: #111827;
	}

	.collapsible-title svg {
		color: #6b7280;
		flex-shrink: 0;
	}

	.count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #e5e7eb;
		color: #374151;
		font-size: 0.75rem;
		font-weight: 700;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		min-width: 1.4rem;
	}

	.chevron {
		color: #9ca3af;
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.chevron.rotated {
		transform: rotate(180deg);
	}

	.collapsible-body {
		padding: 0 1.25rem 1.25rem;
		border-top: 1px solid #f3f4f6;
	}

	/* Field updates */
	.muted {
		margin: 0.75rem 0 0;
		color: #6b7280;
	}

	.error-text {
		margin: 0;
		color: #b91c1c;
	}

	.field-updates-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding-top: 0.75rem;
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

	.updates {
		display: grid;
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.update {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 1rem 1.1rem;
		background: #fff;
	}

	.update-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: #111827;
		color: #fff;
		font-size: 0.8rem;
		font-weight: 800;
	}

	.update-date {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.update-body {
		margin: 0 0 0.8rem;
		color: #111827;
		line-height: 1.45;
		white-space: pre-wrap;
	}

	.update-photos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.6rem;
	}

	/* Photos grid */
	.photos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.photo {
		display: block;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.photo img {
		display: block;
		width: 100%;
		height: 120px;
		object-fit: cover;
	}

	.view-all-photos {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 1rem;
		color: #1d4ed8;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
	}

	.view-all-photos:hover {
		color: #1e40af;
		text-decoration: underline;
	}

	/* Deal details */
	.details-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.details-grid h4 {
		margin: 0 0 0.35rem;
	}

	.details-grid p {
		margin: 0;
		color: #374151;
	}

	.scope-text {
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.address-link {
		color: #1d4ed8;
		text-decoration: underline;
	}

	.address-link:hover {
		color: #1e40af;
	}

	.notes {
		grid-column: 1 / -1;
	}

	.file-list {
		margin: 0;
		padding-left: 1.1rem;
	}

	.file-list li {
		margin: 0.3rem 0;
	}

	.file-link {
		color: #1d4ed8;
		text-decoration: underline;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	.file-link:hover {
		color: #1e40af;
	}

	/* Tasks */
	.task-group-name {
		margin: 0.85rem 0 0.4rem;
		font-size: 0.82rem;
		font-weight: 700;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.task-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.task-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.task-info {
		min-width: 0;
		flex: 1;
	}

	.task-name {
		margin: 0;
		font-weight: 600;
		font-size: 0.9rem;
		line-height: 1.3;
	}

	.task-assignee {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		color: #6b7280;
	}

	.task-error {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: #b91c1c;
	}

	/* Status select (Zoho projects — editable) */
	.task-status-select {
		appearance: auto;
		padding: 0.25rem 0.4rem;
		border-radius: 6px;
		font-weight: 500;
		font-size: 0.75rem;
		min-height: 28px;
		max-width: 110px;
		width: 110px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #111827;
		cursor: pointer;
		flex-shrink: 0;
		-webkit-tap-highlight-color: transparent;
	}

	.task-status-select:disabled { opacity: 0.6; cursor: not-allowed; }
	.task-status-select.task-status-not_started { border-color: #d1d5db; background: #f9fafb; }
	.task-status-select.task-status-in_progress  { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
	.task-status-select.task-status-completed    { border-color: #86efac; background: #f0fdf4; color: #15803d; }

	/* Status badge (CRM deals — read-only) */
	.task-status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		white-space: nowrap;
		flex-shrink: 0;
		border: 1px solid transparent;
	}

	.task-status-badge.task-status-not_started { background: #f3f4f6; color: #6b7280;  border-color: #e5e7eb; }
	.task-status-badge.task-status-in_progress  { background: #eff6ff; color: #1d4ed8; border-color: #93c5fd; }
	.task-status-badge.task-status-completed    { background: #f0fdf4; color: #15803d; border-color: #86efac; }

	@media (min-width: 640px) {
		.dashboard {
			padding: 2rem;
		}

		.card {
			padding: 1.5rem;
		}

		.collapsible-toggle {
			padding: 1.25rem 1.5rem;
		}

		.collapsible-body {
			padding: 0 1.5rem 1.5rem;
		}
	}
</style>
