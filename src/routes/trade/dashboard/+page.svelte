<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import DealCard from '$lib/components/designer/DealCard.svelte';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import { formatCrmRichText, decodeHtmlEntities } from '$lib/html';
	import type { DealFieldDescriptor, DesignerDealSummary } from '$lib/types/designer';

	export let data: {
		tradePartner: { name?: string | null; email: string };
	};

	const tradePartner = data?.tradePartner || { email: '' };

	// Deals are fetched client-side after mount — no Zoho call blocks login
	let deals: any[] = [];
	let dealsLoading = true;
	let dealsWarning = '';
	let dealsSyncing = false;
	let designerDeals: DesignerDealSummary[] = [];
	let designerFieldDescriptors: DealFieldDescriptor[] = [];
	let selectedDealId = '';
	let dealTab: 'details' | 'tasks' | 'field_updates' | 'change_orders' = 'details';

	onMount(async () => {
		try {
			const res = await fetch('/api/trade/deals');
			if (res.status === 401) { window.location.href = '/auth/trade'; return; }
			if (res.ok) {
				const body = await res.json().catch(() => ({}));
				deals = Array.isArray(body.deals) ? body.deals : [];
				designerDeals = Array.isArray(body.designerDeals) ? body.designerDeals : [];
				designerFieldDescriptors = Array.isArray(body.designerFieldDescriptors)
					? body.designerFieldDescriptors
					: [];
				dealsWarning = body.warning ?? '';
				dealsSyncing = body.syncing ?? false;
				if (deals.length > 0) selectedDealId = deals[0].id;
				const params = new URLSearchParams(window.location.search);
				const paramId = params.get('deal');
				if (paramId && deals.find((d: any) => d.id === paramId)) selectedDealId = paramId;
			}
		} catch { /* non-fatal */ } finally {
			dealsLoading = false;
		}
		loadProjectsList();
	});

	$: selectedDeal = deals.find((deal) => deal.id === selectedDealId);
	// Designer Homepage data for the selected project — rendered read-only
	// inside the Details tab so trade partners see the designer sections
	// (Core, Scope, Address, Access & links, notes) without leaving the tab.
	$: selectedDesignerDeal = designerDeals.find((d) => d.id === selectedDealId);

	function syncDashboardUrl() {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		if (selectedDealId) {
			params.set('deal', selectedDealId);
		} else {
			params.delete('deal');
		}
		params.delete('tab');
		const query = params.toString();
		const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
		window.history.replaceState({}, '', nextUrl);
	}

	$: if (browser) {
		syncDashboardUrl();
	}

	type FieldUpdate = {
		id: string;
		createdAt: string | null;
		updatedAt: string | null;
		type: string | null;
		body: string | null;
		photos: Array<{ name: string; url: string }>;
	};

	// Parse External_Link field — Zoho stores shareable links here (WorkDrive, Google Drive, etc.)
	// Can be a plain URL string, array of {url, name} objects, or JSON string.
	function parseExternalLinks(raw: any): Array<{ name: string; url: string }> {
		if (!raw) return [];
		let items: any[] = [];
		if (typeof raw === 'string') {
			// Could be a plain URL or JSON
			const trimmed = raw.trim();
			if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
				try { items = JSON.parse(trimmed); } catch { /* fall through */ }
				if (!Array.isArray(items)) items = items ? [items] : [];
			} else {
				// Plain URL in External_Link points to the project's client folder root,
				// not the Designs subfolder — skip it. The Designs link is fetched
				// separately via /api/trade/deals/[dealId]/designs.
				return [];
			}
		} else if (Array.isArray(raw)) {
			items = raw;
		} else if (typeof raw === 'object') {
			items = [raw];
		}
		return items
			.filter((f) => f && typeof f === 'object')
			.map((f) => {
				const name = f.name ?? f.title ?? f.File_Name ?? f.filename ?? 'Design File';
				const url = f.url ?? f.link ?? f.href ?? f.download_url ?? '';
				return { name: String(name), url: String(url) };
			})
			.filter((f) => f.url.startsWith('http'));
	}

	// ── Details: External_Link (immediate) + lazy Scopes / Designs links ──────
	$: externalLinks = parseExternalLinks(selectedDeal?.External_Link);

	// Lazy file listing for Designs + SOW folders.
	interface DesignFile { id: string; name: string; mime: string | null; modifiedTime: string | null; url?: string | null; }
	interface FilesPayload {
		designs: DesignFile[];
		sow: DesignFile[];
		// Internal WorkDrive URLs (signed-in users only). We prefer these over
		// the external client-portal share for the trade/staff dashboard.
		projectFolderUrl: string | null;
		designsFolderUrl: string | null;
		sowFolderUrl: string | null;
	}
	const filesCache = new Map<string, FilesPayload>();
	let designsFiles: DesignFile[] = [];
	let sowFiles: DesignFile[] = [];
	let projectFolderUrl = '';
	let designsFolderInternalUrl = '';
	let sowFolderInternalUrl = '';
	let filesLoading = false;
	let lastFilesDealId = '';

	const applyFilesPayload = (payload: FilesPayload) => {
		designsFiles = payload.designs;
		sowFiles = payload.sow;
		projectFolderUrl = payload.projectFolderUrl ?? '';
		designsFolderInternalUrl = payload.designsFolderUrl ?? '';
		sowFolderInternalUrl = payload.sowFolderUrl ?? '';
	};

	const loadFiles = async (dealId: string) => {
		if (!dealId) return;
		if (filesCache.has(dealId)) {
			applyFilesPayload(filesCache.get(dealId)!);
			return;
		}
		filesLoading = true;
		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(dealId)}/designs/files`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.json().catch(() => ({}));
			const payload: FilesPayload = {
				designs: Array.isArray(raw?.designs) ? raw.designs : [],
				sow: Array.isArray(raw?.sow) ? raw.sow : [],
				projectFolderUrl: typeof raw?.projectFolderUrl === 'string' ? raw.projectFolderUrl : null,
				designsFolderUrl: typeof raw?.designsFolderUrl === 'string' ? raw.designsFolderUrl : null,
				sowFolderUrl: typeof raw?.sowFolderUrl === 'string' ? raw.sowFolderUrl : null
			};
			filesCache.set(dealId, payload);
			if (dealId === selectedDealId) applyFilesPayload(payload);
		} catch (err) {
			console.warn('[trade/dashboard] file list fetch failed', err);
			if (dealId === selectedDealId) {
				designsFiles = [];
				sowFiles = [];
				projectFolderUrl = '';
				designsFolderInternalUrl = '';
				sowFolderInternalUrl = '';
			}
		} finally {
			filesLoading = false;
		}
	};

	// Lazy SOW (Scopes) folder URL fetch — Project > Design and Planning > SOW
	const sowUrlCache = new Map<string, string>();
	let sowUrl = '';
	let sowLoading = false;
	let sowError = '';
	let lastSowDealId = '';

	const loadSowUrl = async (dealId: string) => {
		if (!dealId) return;
		if (sowUrlCache.has(dealId)) {
			sowUrl = sowUrlCache.get(dealId)!;
			return;
		}
		sowLoading = true;
		sowError = '';
		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(dealId)}/sow`);
			if (!res.ok) throw new Error(`Failed to load scopes (${res.status})`);
			const payload = await res.json().catch(() => ({}));
			const fresh = typeof payload?.url === 'string' ? payload.url : '';
			sowUrlCache.set(dealId, fresh);
			if (dealId === selectedDealId) sowUrl = fresh;
		} catch (err) {
			sowError = err instanceof Error ? err.message : 'Failed to load scopes';
			if (!sowUrlCache.has(dealId)) sowUrl = '';
		} finally {
			sowLoading = false;
		}
	};

	// Lazy Designs folder URL fetch — Project > Design and Planning > Designs
	const designsUrlCache = new Map<string, string>();
	let designsUrl = '';
	let designsLoading = false;
	let designsError = '';
	let lastDesignsDealId = '';

	const loadDesignsUrl = async (dealId: string) => {
		if (!dealId) return;
		if (designsUrlCache.has(dealId)) {
			designsUrl = designsUrlCache.get(dealId)!;
			return;
		}
		designsLoading = true;
		designsError = '';
		try {
			const res = await fetch(`/api/trade/deals/${encodeURIComponent(dealId)}/designs`);
			if (!res.ok) throw new Error(`Failed to load designs (${res.status})`);
			const payload = await res.json().catch(() => ({}));
			const fresh = typeof payload?.url === 'string' ? payload.url : '';
			designsUrlCache.set(dealId, fresh);
			if (dealId === selectedDealId) designsUrl = fresh;
		} catch (err) {
			designsError = err instanceof Error ? err.message : 'Failed to load designs';
			if (!designsUrlCache.has(dealId)) designsUrl = '';
		} finally {
			designsLoading = false;
		}
	};

	// Combined details list: Scopes, Designs, Change Orders, then any structured External_Link entries (deduped)
	$: designFiles = (() => {
		const seen = new Set<string>();
		const combined: Array<{ name: string; url: string }> = [];
		if (sowUrl) {
			combined.push({ name: 'Scopes', url: sowUrl });
			seen.add(sowUrl);
		}
		if (designsUrl) {
			combined.push({ name: 'Designs', url: designsUrl });
			seen.add(designsUrl);
		}
		const changeOrdersUrl = String(selectedDeal?.WD_Change_Orders || '').trim();
		if (changeOrdersUrl && /^https?:\/\//i.test(changeOrdersUrl) && !seen.has(changeOrdersUrl)) {
			combined.push({ name: 'Change Orders', url: changeOrdersUrl });
			seen.add(changeOrdersUrl);
		}
		for (const f of externalLinks) {
			if (f.url && !seen.has(f.url)) { seen.add(f.url); combined.push(f); }
		}
		return combined;
	})();

	// When the Details tab is active, kick off Scopes + Designs URL fetches for current deal
	$: if (browser && dealTab === 'details' && selectedDealId && selectedDealId !== lastSowDealId) {
		lastSowDealId = selectedDealId;
		loadSowUrl(selectedDealId);
	}
	$: if (browser && dealTab === 'details' && selectedDealId && selectedDealId !== lastDesignsDealId) {
		lastDesignsDealId = selectedDealId;
		loadDesignsUrl(selectedDealId);
	}
	$: if (browser && dealTab === 'details' && selectedDealId && selectedDealId !== lastFilesDealId) {
		lastFilesDealId = selectedDealId;
		loadFiles(selectedDealId);
	}

	// Reset SOW / Designs URLs when deal changes so stale data isn't shown while loading
	$: if (selectedDealId !== lastDesignsDealId && !designsUrlCache.has(selectedDealId)) {
		designsUrl = '';
	}
	$: if (selectedDealId !== lastSowDealId && !sowUrlCache.has(selectedDealId)) {
		sowUrl = '';
	}
	$: if (selectedDealId !== lastFilesDealId && !filesCache.has(selectedDealId)) {
		designsFiles = [];
		sowFiles = [];
	}

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
	let taskSubmitting = false;
	let taskSubmitMessage = '';
	// Only tracks selects the user has actually changed — starts empty
	let pendingChanges: Record<string, string> = {};

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

	const loadTasks = async (dealId: string, bustCache = false) => {
		if (!dealId) return;
		updatingTaskIds = new Set();
		taskStatusErrors = new Map();

		const project = projectsList.find((p: any) => p.deal_id === dealId || p.id === dealId);
		const isCrm = !project || project?.source === 'crm_deal';

		// Only Zoho Projects have tasks — CRM-only deals show nothing.
		// (CRM Activities/Tasks were briefly surfaced here but are the wrong
		// data set; trade partners only want the Zoho Projects task list.)
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
		const qs = bustCache ? '?fresh' : '';

		try {
			const res = await fetch(`/api/trade/projects/${encodeURIComponent(projectId)}${qs}`);
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

	const submitTasks = async () => {
		if (taskSubmitting || !isZohoProject || !selectedProjectId) return;
		const updates = Object.entries(pendingChanges).map(([taskId, status]) => ({ taskId, status }));
		if (!updates.length) { taskSubmitMessage = 'No changes to submit.'; return; }

		taskSubmitting = true;
		taskSubmitMessage = '';

		// Use the proven single-task endpoint for each change, all in parallel
		const settled = await Promise.allSettled(
			updates.map(({ taskId, status }) =>
				fetch(`/api/trade/projects/${encodeURIComponent(selectedProjectId)}/tasks/${encodeURIComponent(taskId)}/status`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status })
				}).then(async (res) => {
					if (res.status === 401) { window.location.href = '/auth/trade'; }
					if (!res.ok) {
						const payload = await res.json().catch(() => ({}));
						throw new Error(payload?.error || `Failed (${res.status})`);
					}
				})
			)
		);

		const ok = settled.filter(r => r.status === 'fulfilled').length;
		const fail = settled.filter(r => r.status === 'rejected').length;
		taskSubmitMessage = fail === 0
			? `✓ ${ok} task${ok !== 1 ? 's' : ''} updated`
			: `✗ ${fail} failed, ${ok} updated`;
		if (fail === 0) {
			pendingChanges = {};
			tasksCache.delete(selectedDealId);
			await loadTasks(selectedDealId, true);
			setTimeout(() => { taskSubmitMessage = ''; }, 4000);
		}
		taskSubmitting = false;
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
			// Invalidate cache and re-fetch for real state (bust server-side 2-min cache)
			tasksCache.delete(selectedDealId);
			await loadTasks(selectedDealId, true);
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

	// --- Change Order request form ---
	let coPanelOpen = false;
	let coNote = '';
	let coPhotoUploadRef: PhotoUpload;
	let coSubmitting = false;
	let coSuccess = '';
	let coSubmitError = '';

	const openChangeOrderPanel = () => {
		coPanelOpen = true;
		coSuccess = '';
		coSubmitError = '';
	};

	const closeChangeOrderPanel = () => {
		coPanelOpen = false;
		coNote = '';
		coPhotoUploadRef?.reset();
		coSubmitError = '';
	};

	const submitChangeOrder = async () => {
		if (!selectedDealId) {
			coSubmitError = 'Please choose a project.';
			return;
		}
		if (!coNote.trim()) {
			coSubmitError = 'Please describe the change you would like to request.';
			return;
		}
		coSubmitting = true;
		coSubmitError = '';
		coSuccess = '';
		try {
			const photoIds = coPhotoUploadRef?.getPhotoIds() ?? [];
			const res = await fetch('/api/trade/field-updates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deal_id: selectedDealId,
					update_type: 'change_order',
					note: coNote.trim(),
					photo_ids: photoIds.length > 0 ? photoIds : null
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				coSubmitError = payload?.error || `Request failed (${res.status})`;
				return;
			}
			coSuccess = 'Change order request submitted. The office team has been notified.';
			coNote = '';
			coPhotoUploadRef?.reset();
			coPanelOpen = false;
			// Refresh the field updates list so the new entry shows up.
			loadFieldUpdates(selectedDealId);
		} catch (err) {
			coSubmitError = err instanceof Error ? err.message : 'Failed to submit change order';
		} finally {
			coSubmitting = false;
		}
	};

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
	</header>

	{#if dealsLoading}
		<div class="skeleton-stack" aria-busy="true" aria-label="Loading projects…">
			<div class="card skeleton-card">
				<div class="skeleton-line w-40"></div>
				<div class="skeleton-line w-64 mt"></div>
			</div>
			<div class="card skeleton-card">
				<div class="skeleton-line w-full"></div>
				<div class="skeleton-line w-48 mt"></div>
				<div class="skeleton-line w-56 mt"></div>
			</div>
		</div>
	{:else if dealsWarning && !dealsSyncing}
		<div class="card warning">{dealsWarning}</div>
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
			<div class="tab-bar">
				<button
					type="button"
					class="tab"
					class:active={dealTab === 'details'}
					on:click={() => (dealTab = 'details')}
				>Details</button>
				<button
					type="button"
					class="tab"
					class:active={dealTab === 'tasks'}
					on:click={() => (dealTab = 'tasks')}
				>Tasks{#if tasks.length > 0}&nbsp;<span class="count-badge">{tasks.length}</span>{/if}</button>
				<button
					type="button"
					class="tab"
					class:active={dealTab === 'field_updates'}
					on:click={() => (dealTab = 'field_updates')}
				>Field Updates{#if fieldUpdates.length > 0}&nbsp;<span class="count-badge">{fieldUpdates.length}</span>{/if}</button>
				<button
					type="button"
					class="tab"
					class:active={dealTab === 'change_orders'}
					on:click={() => (dealTab = 'change_orders')}
				>Change Orders</button>
			</div>
		{/if}

		{#if selectedDeal && dealTab === 'details'}
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
					</div>
			</div>

			<!-- Files & links -->
			<div class="card section-card">
				<h3 class="section-title">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<path d="M4 4h12v12H4z"/>
						<path d="M4 16l4-5 3 3 2-2 3 4"/>
						<circle cx="13" cy="8" r="1.5"/>
					</svg>
					Files &amp; Links
				</h3>
				<div class="section-body">
						{#if (sowLoading || designsLoading || filesLoading) && designsFiles.length === 0 && sowFiles.length === 0 && designFiles.length === 0}
							<p class="muted">Loading details...</p>
						{:else}
							<!-- Project root (internal WorkDrive) — the main folder link
							     trade partners and staff use. Falls back to nothing if the
							     deal has no WorkDrive folder yet. -->
							{#if projectFolderUrl}
								<div class="folder-section">
									<div class="folder-header">
										<span class="folder-title">Project folder</span>
										<a class="open-folder" href={projectFolderUrl} target="_blank" rel="noreferrer">Open in WorkDrive ↗</a>
									</div>
								</div>
							{/if}

							<!-- Scopes (SOW) section -->
							<div class="folder-section">
								<div class="folder-header">
									<span class="folder-title">Scopes</span>
									{#if sowFolderInternalUrl}
										<a class="open-folder" href={sowFolderInternalUrl} target="_blank" rel="noreferrer">Open folder ↗</a>
									{:else if sowUrl}
										<a class="open-folder" href={sowUrl} target="_blank" rel="noreferrer">Open folder ↗</a>
									{/if}
								</div>
								{#if sowFiles.length > 0}
									<ul class="file-list">
										{#each sowFiles as f (f.id)}
											<li>
												{#if f.url}
													<a class="file-link" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
												{:else}
													<span class="file-name">{f.name}</span>
												{/if}
											</li>
										{/each}
									</ul>
								{:else}
									<p class="muted small">No scope files found.</p>
								{/if}
							</div>

							<!-- Designs section -->
							<div class="folder-section">
								<div class="folder-header">
									<span class="folder-title">Designs</span>
									{#if designsFolderInternalUrl}
										<a class="open-folder" href={designsFolderInternalUrl} target="_blank" rel="noreferrer">Open folder ↗</a>
									{:else if designsUrl}
										<a class="open-folder" href={designsUrl} target="_blank" rel="noreferrer">Open folder ↗</a>
									{/if}
								</div>
								{#if designsFiles.length > 0}
									<ul class="file-list">
										{#each designsFiles as f (f.id)}
											<li>
												{#if f.url}
													<a class="file-link" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
												{:else}
													<span class="file-name">{f.name}</span>
												{/if}
											</li>
										{/each}
									</ul>
								{:else}
									<p class="muted small">No design files found.</p>
								{/if}
							</div>

							<!-- Any extra External_Link entries (Change Orders, etc.) -->
							{#if designFiles.length > 0}
								<div class="folder-section">
									<div class="folder-header">
										<span class="folder-title">Other links</span>
									</div>
									<ul class="file-list">
										{#each designFiles.filter((f) => f.name !== 'Scopes' && f.name !== 'Designs') as file}
											<li>
												<a class="file-link" href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
											</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if (sowError || designsError)}
								<div class="field-updates-error">
									<p class="error-text">{sowError || designsError}</p>
									<button class="retry" type="button" on:click={() => {
										sowUrlCache.delete(selectedDealId); lastSowDealId = ''; loadSowUrl(selectedDealId);
										designsUrlCache.delete(selectedDealId); lastDesignsDealId = ''; loadDesignsUrl(selectedDealId);
										filesCache.delete(selectedDealId); lastFilesDealId = ''; loadFiles(selectedDealId);
									}}>Retry</button>
								</div>
							{/if}
						{/if}
					</div>
			</div>

			<!-- Designer Homepage sections (read-only) -->
			{#if selectedDesignerDeal}
				<div class="card section-card">
					<h3 class="section-title">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
							<path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.4l-4.8 2.5.9-5.4L2.2 7.7l5.4-.8L10 2z"/>
						</svg>
						Designer Info
					</h3>
					<div class="section-body designer-embed">
						{#key selectedDesignerDeal.id}
							<DealCard
								deal={selectedDesignerDeal}
								fieldDescriptors={designerFieldDescriptors}
								readonly={true}
								expanded={true}
							/>
						{/key}
					</div>
				</div>
			{/if}
		{/if}

		{#if selectedDeal && dealTab === 'tasks'}
			<!-- Tasks -->
			<div class="card section-card">
				<h3 class="section-title">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<path d="M4 5h12M4 10h8M4 15h10"/>
						<circle cx="17" cy="10" r="3"/>
					</svg>
					Tasks
					{#if !tasksLoading && tasks.length > 0}
						<span class="count-badge">{tasks.length}</span>
					{/if}
				</h3>
				<div class="section-body">
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
											</div>
											{#if isZohoProject}
												<select
													class="task-status-select task-status-{pendingChanges[tid] ?? getTaskStatusValue(task)}"
													value={pendingChanges[tid] ?? getTaskStatusValue(task)}
													disabled={taskSubmitting}
													on:change={(e) => { pendingChanges[tid] = e.currentTarget.value; pendingChanges = pendingChanges; }}
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
				{#if isZohoProject}
					<div class="task-submit-row">
						<button class="task-submit-btn" type="button" on:click={submitTasks} disabled={taskSubmitting}>
							{taskSubmitting ? 'Saving...' : 'Submit Changes'}
						</button>
						{#if taskSubmitMessage}
							<span class={taskSubmitMessage.startsWith('✓') ? 'task-submit-ok' : 'task-submit-err'}>{taskSubmitMessage}</span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if selectedDeal && dealTab === 'field_updates'}
			<!-- Submit a field update -->
			<div class="card embedded-form">
				<iframe
					title="Field Update"
					src={'/trade/field-update?embed=1&deal=' + encodeURIComponent(selectedDealId)}
					class="field-update-iframe"
				></iframe>
			</div>

			<!-- Field update history -->
			<div class="card section-card">
				<h3 class="section-title">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<rect x="3" y="2" width="14" height="16" rx="2"/>
						<path d="M7 6h6M7 10h6M7 14h4"/>
					</svg>
					Submitted Updates
					{#if !fieldUpdatesLoading && fieldUpdates.length > 0}
						<span class="count-badge">{fieldUpdates.length}</span>
					{/if}
				</h3>
				<div class="section-body">
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
													{@const isVid = /\.(mp4|mov|avi|webm|mkv|wmv|hevc)$/i.test(photo.name || photo.url)}
													<a class="photo" href={photo.url} target="_blank" rel="noreferrer">
														{#if isVid}
															<video src={photo.url} class="photo-media" muted playsinline preload="metadata"></video>
															<span class="photo-play">▶</span>
														{:else}
															<img src={photo.url} alt={photo.name} class="photo-media" loading="lazy" />
														{/if}
													</a>
												{/each}
											</div>
										{/if}
									</article>
								{/each}
							</div>
						{/if}
					</div>
			</div>
		{/if}

		{#if selectedDeal && dealTab === 'change_orders'}
			<!-- Change Orders -->
			<div class="card section-card">
				<h3 class="section-title">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<path d="M12 2l6 6-10 10H2v-6L12 2z"/>
						<path d="M9 5l6 6"/>
					</svg>
					Change Orders
				</h3>
				<div class="section-body">
						<div class="co-request-area">
							{#if coSuccess}
								<div class="co-banner co-banner-success">{coSuccess}</div>
							{/if}

							{#if !coPanelOpen}
								<button class="co-request-btn" type="button" on:click={openChangeOrderPanel}>
									Request a Change Order
								</button>
							{:else}
								<div class="co-panel">
									{#if deals.length > 1}
										<div class="co-field">
											<label for="co-deal-select">Project</label>
											<select id="co-deal-select" bind:value={selectedDealId}>
												<option value="" disabled>Select a project…</option>
												{#each deals as deal}
													<option value={deal.id}>{getDealLabel(deal)}</option>
												{/each}
											</select>
										</div>
									{/if}

									<div class="co-field">
										<label for="co-note">Describe the change you would like</label>
										<textarea
											id="co-note"
											rows="6"
											bind:value={coNote}
											placeholder="What would you like changed or added? Add as much detail as you can."
										></textarea>
									</div>

									<div class="co-field">
										<!-- svelte-ignore a11y_label_has_associated_control -->
										<label>Photos / videos (optional)</label>
										<PhotoUpload bind:this={coPhotoUploadRef} maxFiles={5} />
									</div>

									{#if coSubmitError}
										<div class="co-banner co-banner-error">{coSubmitError}</div>
									{/if}

									<div class="co-actions">
										<button
											class="co-submit-btn"
											type="button"
											on:click={submitChangeOrder}
											disabled={coSubmitting || !coNote.trim() || !selectedDealId}
										>
											{coSubmitting ? 'Submitting…' : 'Submit request'}
										</button>
										<button
											class="co-cancel-btn"
											type="button"
											on:click={closeChangeOrderPanel}
											disabled={coSubmitting}
										>
											Cancel
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
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

	.folder-section {
		margin-bottom: 1.25rem;
	}
	.folder-section:last-child {
		margin-bottom: 0;
	}
	.folder-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid #e5e7eb;
	}
	.folder-title {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #374151;
	}
	.open-folder {
		font-size: 0.8rem;
		color: #1e40af;
		text-decoration: none;
	}
	.open-folder:hover {
		text-decoration: underline;
	}
	.file-name {
		color: #111827;
		font-size: 0.92rem;
	}
	.muted.small {
		font-size: 0.85rem;
	}

	.card {
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem;
		background: #fff;
		margin-bottom: 1rem;
	}

	/* Skeleton loader */
	.skeleton-stack {
		display: grid;
		gap: 1rem;
	}

	.skeleton-card {
		padding: 1.25rem;
	}

	.skeleton-line {
		height: 14px;
		border-radius: 6px;
		background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}

	.skeleton-line.mt { margin-top: 0.75rem; }
	.skeleton-line.w-40 { width: 40%; }
	.skeleton-line.w-48 { width: 48%; }
	.skeleton-line.w-56 { width: 56%; }
	.skeleton-line.w-64 { width: 64%; }
	.skeleton-line.w-full { width: 100%; }

	@keyframes shimmer {
		0%   { background-position: 200% 0; }
		100% { background-position: -200% 0; }
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

	/* Section cards (one per data set, shown by the active tab) */
	.section-card {
		padding: 0;
		overflow: hidden;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		font-weight: 700;
		color: #111827;
		margin: 0;
		padding: 1.1rem 1.25rem 0.5rem;
	}

	.section-title svg {
		color: #6b7280;
		flex-shrink: 0;
	}

	.section-body {
		padding: 0 1.25rem 1.25rem;
	}

	.designer-embed :global(section.card) {
		border: none;
		padding: 0;
		margin: 0;
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

	.photo {
		display: block;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.photo-media {
		display: block;
		width: 100%;
		height: 120px;
		object-fit: cover;
	}

	.photo {
		position: relative;
	}

	.photo-play {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		color: #fff;
		text-shadow: 0 1px 4px rgba(0,0,0,0.6);
		pointer-events: none;
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
		margin: 0.75rem 0 0;
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

	.task-submit-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid #e5e7eb;
	}
	.task-submit-btn {
		padding: 0.55rem 1.25rem;
		border-radius: 8px;
		font-weight: 700;
		font-size: 0.88rem;
		background: #111827;
		color: #fff;
		border: none;
		cursor: pointer;
		min-height: 40px;
	}
	.task-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.task-submit-ok { color: #16a34a; font-weight: 600; font-size: 0.9rem; }
	.task-submit-err { color: #dc2626; font-weight: 600; font-size: 0.9rem; }

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

		.section-title {
			padding: 1.25rem 1.5rem 0.5rem;
		}

		.section-body {
			padding: 0 1.5rem 1.5rem;
		}
	}

	/* ── Change-order request form ────────────────────── */
	.co-request-area {
		padding: 0.25rem 0;
	}

	.co-request-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-request-btn:hover {
		background: #0052a3;
	}

	.co-panel {
		display: grid;
		gap: 1rem;
		background: #f9fafb;
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		padding: 1.1rem;
	}

	.co-field {
		display: grid;
		gap: 0.4rem;
	}

	.co-field label {
		font-weight: 600;
		font-size: 0.92rem;
		color: #111827;
	}

	.co-panel textarea,
	.co-panel select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-family: inherit;
		font-size: 1rem;
		min-height: 44px;
		background: #fff;
	}

	.co-panel textarea {
		resize: vertical;
		min-height: 120px;
		line-height: 1.5;
	}

	.co-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.co-submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-submit-btn:hover:not(:disabled) {
		background: #0052a3;
	}

	.co-submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.co-cancel-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: #1a1a1a;
		border: 1px solid #d0d0d0;
		border-radius: 8px;
		padding: 0.7rem 1.1rem;
		min-height: 44px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.co-cancel-btn:hover:not(:disabled) {
		background: #f5f5f5;
	}

	.co-cancel-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.co-banner {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.95rem;
		margin-bottom: 0.85rem;
	}

	.co-banner-success {
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
	}

	.co-banner-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #b91c1c;
	}

	.tab-bar {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid #e5e7eb;
		margin: 1rem 0;
		overflow-x: auto;
	}
	.tab-bar .tab {
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
		padding: 0.55rem 1rem;
		border: none;
		background: transparent;
		color: #6b7280;
		font-weight: 600;
		font-size: 0.95rem;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}
	.tab-bar .tab.active {
		color: #111827;
		border-bottom-color: #2563eb;
	}
	.tab-bar .tab:hover {
		color: #111827;
	}
	.embedded-form {
		padding: 0;
		overflow: hidden;
	}
	.field-update-iframe {
		width: 100%;
		height: 1400px;
		border: 0;
		display: block;
	}
</style>
