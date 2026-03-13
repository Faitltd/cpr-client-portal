<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { selectedDealId } from '$lib/stores/dealContext';

	export let data: PageData;
	const dealId = data.dealId;
	selectedDealId.set(dealId);

	// ── Types ────────────────────────────────────────────────────────────────

	interface ScopeTask {
		id: string;
		deal_id: string;
		task_name: string;
		phase: string;
		trade: string | null;
		description: string | null;
		duration_days: number;
		sort_order: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		dependency_id: string | null;
	}

	interface TaskTemplate {
		id: string;
		project_type: string;
		phase: string;
		task_name: string;
		trade: string | null;
		description: string | null;
		default_duration_days: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		sort_order: number;
	}

	interface CrmDeal {
		deal_name: string;
		stage: string;
		contact_name: string;
		all_fields: Record<string, any>;
	}

	interface GenResult {
		success: boolean;
		zohoProjectId?: string | null;
		phasesCreated: number;
		tasklistsCreated: number;
		tasksCreated: number;
		tasksTotal: number;
		error?: string;
	}

	// ── Constants ────────────────────────────────────────────────────────────

	const PHASES = ['preconstruction', 'demo', 'rough', 'finish', 'closeout'] as const;

	const PHASE_COLORS: Record<string, string> = {
		preconstruction: '#6b7280',
		demo: '#dc2626',
		rough: '#d97706',
		finish: '#059669',
		closeout: '#7c3aed'
	};

	const PHASE_LABELS: Record<string, string> = {
		preconstruction: 'Preconstruction',
		demo: 'Demo',
		rough: 'Rough',
		finish: 'Finish',
		closeout: 'Closeout'
	};

	const TRADE_OPTIONS = [
		'plumbing', 'electrical', 'tile', 'paint', 'general', 'hvac',
		'framing', 'drywall', 'flooring', 'cabinetry', 'countertops',
		'roofing', 'siding', 'windows', 'doors'
	];

	const TRADE_COLORS: Record<string, string> = {
		plumbing: '#2563eb',
		electrical: '#d97706',
		tile: '#059669',
		paint: '#7c3aed',
		general: '#6b7280',
		hvac: '#dc2626',
		framing: '#92400e',
		drywall: '#64748b',
		flooring: '#b45309',
		cabinetry: '#6d28d9',
		countertops: '#0891b2',
		roofing: '#374151',
		siding: '#4f46e5',
		windows: '#0284c7',
		doors: '#9333ea'
	};

	// ── State ────────────────────────────────────────────────────────────────

	// Section A: CRM
	let crmDeal: CrmDeal | null = null;
	let crmLoading = false;
	let crmError = '';
	let crmExpanded = false;

	// Section B: Tasks
	let tasks: ScopeTask[] = [];
	let tasksLoading = true;
	let tasksError = '';
	let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let editingTaskId: string | null = null;

	// Library modal
	let libraryOpen = false;
	let libraryTemplates: TaskTemplate[] = [];
	let libraryLoading = false;
	let libraryFilter = '';
	let libraryPhaseFilter = '';

	// Section C: Generate
	let startDate = new Date().toISOString().split('T')[0];
	let generating = false;
	let genResult: GenResult | null = null;
	let genError = '';

	// Collapsed phases
	let collapsedPhases: Record<string, boolean> = {};

	// ── Derived ──────────────────────────────────────────────────────────────

	$: tasksByPhase = (() => {
		const map = new Map<string, ScopeTask[]>();
		for (const phase of PHASES) {
			map.set(phase, tasks.filter((t) => t.phase === phase).sort((a, b) => a.sort_order - b.sort_order));
		}
		return map;
	})();

	$: totalTasks = tasks.length;
	$: totalDays = tasks.reduce((s, t) => s + t.duration_days, 0);
	$: totalInspections = tasks.filter((t) => t.requires_inspection).length;
	$: totalDecisions = tasks.filter((t) => t.requires_client_decision).length;

	$: filteredLibrary = (() => {
		let list = libraryTemplates;
		if (libraryPhaseFilter) list = list.filter((t) => t.phase === libraryPhaseFilter);
		if (libraryFilter) {
			const q = libraryFilter.toLowerCase();
			list = list.filter(
				(t) =>
					t.task_name.toLowerCase().includes(q) ||
					(t.trade && t.trade.toLowerCase().includes(q))
			);
		}
		return list;
	})();

	// ── Init ─────────────────────────────────────────────────────────────────

	onMount(async () => {
		await loadTasks();
	});

	// ── Section A: CRM ──────────────────────────────────────────────────────

	async function fetchCrmDeal() {
		crmLoading = true;
		crmError = '';
		try {
			const res = await fetch(`/api/admin/crm-scope/${encodeURIComponent(dealId)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to fetch deal');
			crmDeal = json.data;
		} catch (err: any) {
			crmError = err.message || 'Failed to fetch CRM data';
		} finally {
			crmLoading = false;
		}
	}

	function getCrmTextFields(): Array<{ key: string; value: string }> {
		if (!crmDeal?.all_fields) return [];
		const fields: Array<{ key: string; value: string }> = [];
		for (const [key, val] of Object.entries(crmDeal.all_fields)) {
			if (typeof val === 'string' && val.trim().length > 0 && val.length < 2000) {
				fields.push({ key, value: val });
			}
		}
		return fields.sort((a, b) => a.key.localeCompare(b.key));
	}

	// ── Section B: Tasks ────────────────────────────────────────────────────

	async function loadTasks() {
		tasksLoading = true;
		tasksError = '';
		try {
			const res = await fetch(`/api/admin/scope-tasks/${encodeURIComponent(dealId)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load tasks');
			tasks = json.data || [];
		} catch (err: any) {
			tasksError = err.message || 'Failed to load tasks';
		} finally {
			tasksLoading = false;
		}
	}

	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveStatus = 'idle';
		saveTimer = setTimeout(() => saveTasks(), 1500);
	}

	async function saveTasks() {
		saveStatus = 'saving';
		try {
			const payload = tasks.map((t, i) => ({
				id: t.id,
				deal_id: dealId,
				task_name: t.task_name,
				phase: t.phase,
				trade: t.trade,
				description: t.description,
				duration_days: t.duration_days,
				sort_order: i,
				requires_inspection: t.requires_inspection,
				requires_client_decision: t.requires_client_decision,
				dependency_id: t.dependency_id
			}));
			const res = await fetch(`/api/admin/scope-tasks/${encodeURIComponent(dealId)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tasks: payload })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to save');
			tasks = json.data || [];
			saveStatus = 'saved';
			setTimeout(() => {
				if (saveStatus === 'saved') saveStatus = 'idle';
			}, 2000);
		} catch (err: any) {
			saveStatus = 'error';
			tasksError = err.message || 'Failed to save tasks';
		}
	}

	function addTask(phase: string) {
		const phaseTasks = tasks.filter((t) => t.phase === phase);
		const newTask: ScopeTask = {
			id: crypto.randomUUID(),
			deal_id: dealId,
			task_name: '',
			phase,
			trade: null,
			description: null,
			duration_days: 1,
			sort_order: phaseTasks.length,
			requires_inspection: false,
			requires_client_decision: false,
			dependency_id: null
		};
		tasks = [...tasks, newTask];
		editingTaskId = newTask.id;
		scheduleSave();
	}

	function removeTask(taskId: string) {
		tasks = tasks.filter((t) => t.id !== taskId);
		if (editingTaskId === taskId) editingTaskId = null;
		scheduleSave();
	}

	function updateTask(taskId: string, field: keyof ScopeTask, value: any) {
		tasks = tasks.map((t) => (t.id === taskId ? { ...t, [field]: value } : t));
		scheduleSave();
	}

	function moveTask(taskId: string, direction: -1 | 1) {
		const idx = tasks.findIndex((t) => t.id === taskId);
		if (idx < 0) return;
		const task = tasks[idx];
		const phaseTasks = tasks.filter((t) => t.phase === task.phase);
		const phaseIdx = phaseTasks.findIndex((t) => t.id === taskId);
		const swapIdx = phaseIdx + direction;
		if (swapIdx < 0 || swapIdx >= phaseTasks.length) return;

		const swapTask = phaseTasks[swapIdx];
		tasks = tasks.map((t) => {
			if (t.id === taskId) return { ...t, sort_order: swapTask.sort_order };
			if (t.id === swapTask.id) return { ...t, sort_order: task.sort_order };
			return t;
		});
		scheduleSave();
	}

	// ── Library ─────────────────────────────────────────────────────────────

	async function openLibrary() {
		libraryOpen = true;
		if (libraryTemplates.length > 0) return;
		libraryLoading = true;
		try {
			const res = await fetch('/api/admin/task-templates?all=true');
			const json = await res.json();
			if (res.ok) libraryTemplates = json.data || [];
		} catch {
			// silently fail
		} finally {
			libraryLoading = false;
		}
	}

	function addFromTemplate(template: TaskTemplate) {
		const phaseTasks = tasks.filter((t) => t.phase === template.phase);
		const newTask: ScopeTask = {
			id: crypto.randomUUID(),
			deal_id: dealId,
			task_name: template.task_name,
			phase: template.phase,
			trade: template.trade,
			description: template.description,
			duration_days: template.default_duration_days,
			sort_order: phaseTasks.length,
			requires_inspection: template.requires_inspection,
			requires_client_decision: template.requires_client_decision,
			dependency_id: null
		};
		tasks = [...tasks, newTask];
		scheduleSave();
	}

	// ── Section C: Generate ─────────────────────────────────────────────────

	async function generateProject() {
		if (tasks.length === 0) return;
		generating = true;
		genResult = null;
		genError = '';
		try {
			// Save tasks first
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			await saveTasks();

			const res = await fetch(`/api/admin/scope-tasks/${encodeURIComponent(dealId)}/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ start_date: startDate })
			});
			const json = await res.json();
			if (!res.ok && !json.data) throw new Error(json.message || 'Generation failed');
			genResult = json.data;
		} catch (err: any) {
			genError = err.message || 'Generation failed';
		} finally {
			generating = false;
		}
	}

	function togglePhase(phase: string) {
		collapsedPhases = { ...collapsedPhases, [phase]: !collapsedPhases[phase] };
	}
</script>

<div class="scope-builder">
	<header class="page-header">
		<h1>Scope Builder</h1>
		<span class="deal-badge">{dealId}</span>
		{#if saveStatus === 'saving'}
			<span class="save-indicator saving">Saving…</span>
		{:else if saveStatus === 'saved'}
			<span class="save-indicator saved">Saved</span>
		{:else if saveStatus === 'error'}
			<span class="save-indicator error">Save failed</span>
		{/if}
	</header>

	<!-- ── Section A: CRM Scope Reference ──────────────────────────────── -->
	<section class="card crm-section">
		<div class="card-header">
			<h2>CRM Scope Reference</h2>
			<button class="btn btn-sm" on:click={fetchCrmDeal} disabled={crmLoading}>
				{crmLoading ? 'Pulling…' : 'Pull from CRM'}
			</button>
		</div>

		{#if crmError}
			<p class="error-text">{crmError}</p>
		{/if}

		{#if crmDeal}
			<div class="crm-summary">
				<div class="crm-field"><strong>Deal:</strong> {crmDeal.deal_name}</div>
				<div class="crm-field"><strong>Stage:</strong> {crmDeal.stage}</div>
				<div class="crm-field"><strong>Contact:</strong> {crmDeal.contact_name}</div>
			</div>

			<button class="btn btn-sm" on:click={() => (crmExpanded = !crmExpanded)}>
				{crmExpanded ? 'Hide' : 'Show'} all CRM fields ({getCrmTextFields().length})
			</button>

			{#if crmExpanded}
				<div class="crm-fields-grid">
					{#each getCrmTextFields() as field}
						<div class="crm-field-item">
							<span class="crm-field-key">{field.key}</span>
							<span class="crm-field-value">{field.value}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	<!-- ── Section B: Task Builder ─────────────────────────────────────── -->
	<section class="card task-section">
		<div class="card-header">
			<h2>Task Builder</h2>
			<div class="header-actions">
				<button class="btn btn-sm" on:click={openLibrary}>Add from Library</button>
				<button class="btn btn-primary btn-sm" on:click={() => saveTasks()} disabled={saveStatus === 'saving'}>
					Save Now
				</button>
			</div>
		</div>

		{#if tasksLoading}
			<p class="loading-text">Loading tasks…</p>
		{:else if tasksError}
			<p class="error-text">{tasksError}</p>
		{/if}

		{#each PHASES as phase}
			{@const phaseTasks = tasksByPhase.get(phase) || []}
			<div class="phase-group">
				<button
					class="phase-header"
					style="border-left: 4px solid {PHASE_COLORS[phase]}"
					on:click={() => togglePhase(phase)}
				>
					<span class="phase-name" style="color: {PHASE_COLORS[phase]}">{PHASE_LABELS[phase]}</span>
					<span class="phase-count">{phaseTasks.length} task{phaseTasks.length !== 1 ? 's' : ''}</span>
					<span class="phase-toggle">{collapsedPhases[phase] ? '+' : '−'}</span>
				</button>

				{#if !collapsedPhases[phase]}
					<div class="phase-tasks">
						{#if phaseTasks.length > 0}
							<div class="task-grid-header">
								<span class="col-name">Task Name</span>
								<span class="col-trade">Trade</span>
								<span class="col-days">Days</span>
								<span class="col-flags">Flags</span>
								<span class="col-actions">Actions</span>
							</div>
						{/if}

						{#each phaseTasks as task (task.id)}
							<div class="task-row" class:editing={editingTaskId === task.id}>
								<div class="col-name">
									<input
										type="text"
										value={task.task_name}
										placeholder="Task name"
										on:focus={() => (editingTaskId = task.id)}
										on:input={(e) => updateTask(task.id, 'task_name', e.currentTarget.value)}
									/>
								</div>
								<div class="col-trade">
									<select
										value={task.trade || ''}
										on:change={(e) => updateTask(task.id, 'trade', e.currentTarget.value || null)}
									>
										<option value="">—</option>
										{#each TRADE_OPTIONS as t}
											<option value={t}>{t}</option>
										{/each}
									</select>
									{#if task.trade}
										<span
											class="trade-dot"
											style="background: {TRADE_COLORS[task.trade] || '#6b7280'}"
										></span>
									{/if}
								</div>
								<div class="col-days">
									<input
										type="number"
										min="1"
										max="365"
										value={task.duration_days}
										on:input={(e) => updateTask(task.id, 'duration_days', parseInt(e.currentTarget.value) || 1)}
									/>
								</div>
								<div class="col-flags">
									<label class="flag-label" title="Requires inspection">
										<input
											type="checkbox"
											checked={task.requires_inspection}
											on:change={() => updateTask(task.id, 'requires_inspection', !task.requires_inspection)}
										/>
										Insp
									</label>
									<label class="flag-label" title="Requires client decision">
										<input
											type="checkbox"
											checked={task.requires_client_decision}
											on:change={() => updateTask(task.id, 'requires_client_decision', !task.requires_client_decision)}
										/>
										Dec
									</label>
								</div>
								<div class="col-actions">
									<button class="icon-btn" title="Move up" on:click={() => moveTask(task.id, -1)}>&#9650;</button>
									<button class="icon-btn" title="Move down" on:click={() => moveTask(task.id, 1)}>&#9660;</button>
									<button class="icon-btn delete-btn" title="Remove" on:click={() => removeTask(task.id)}>&#10005;</button>
								</div>
							</div>

							{#if editingTaskId === task.id}
								<div class="task-detail-row">
									<textarea
										placeholder="Description (optional)"
										value={task.description || ''}
										on:input={(e) => updateTask(task.id, 'description', e.currentTarget.value || null)}
										rows="2"
									></textarea>
								</div>
							{/if}
						{/each}

						<button class="add-task-btn" on:click={() => addTask(phase)}>
							+ Add task to {PHASE_LABELS[phase]}
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</section>

	<!-- ── Section C: Summary & Generate ───────────────────────────────── -->
	<section class="card generate-section">
		<h2>Summary & Generate</h2>

		<div class="stats-bar">
			<div class="stat">
				<span class="stat-value">{totalTasks}</span>
				<span class="stat-label">Tasks</span>
			</div>
			<div class="stat">
				<span class="stat-value">{totalDays}</span>
				<span class="stat-label">Total Days</span>
			</div>
			<div class="stat">
				<span class="stat-value">{totalInspections}</span>
				<span class="stat-label">Inspections</span>
			</div>
			<div class="stat">
				<span class="stat-value">{totalDecisions}</span>
				<span class="stat-label">Decisions</span>
			</div>
		</div>

		<div class="generate-controls">
			<label class="date-label">
				Start Date
				<input type="date" bind:value={startDate} />
			</label>
			<button
				class="btn btn-primary"
				on:click={generateProject}
				disabled={generating || tasks.length === 0}
			>
				{generating ? 'Generating…' : 'Generate Zoho Project'}
			</button>
		</div>

		{#if genError}
			<div class="gen-error">{genError}</div>
		{/if}

		{#if genResult}
			<div class="gen-result" class:gen-success={genResult.success} class:gen-fail={!genResult.success}>
				{#if genResult.success}
					<p><strong>Project created successfully!</strong></p>
					<p>Zoho Project ID: <code>{genResult.zohoProjectId}</code></p>
				{:else}
					<p><strong>Generation failed</strong></p>
					{#if genResult.error}
						<p class="error-text">{genResult.error}</p>
					{/if}
				{/if}
				<div class="gen-stats">
					<span>Phases: {genResult.phasesCreated}</span>
					<span>Tasklists: {genResult.tasklistsCreated}</span>
					<span>Tasks: {genResult.tasksCreated}/{genResult.tasksTotal}</span>
				</div>
			</div>
		{/if}
	</section>
</div>

<!-- ── Library Modal ───────────────────────────────────────────────────── -->
{#if libraryOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-overlay" on:click|self={() => (libraryOpen = false)} role="dialog" aria-modal="true" tabindex="-1">
		<div class="modal">
			<div class="modal-header">
				<h3>Task Library</h3>
				<button class="icon-btn" on:click={() => (libraryOpen = false)}>&#10005;</button>
			</div>
			<div class="modal-filters">
				<input
					type="text"
					placeholder="Search tasks…"
					bind:value={libraryFilter}
				/>
				<select bind:value={libraryPhaseFilter}>
					<option value="">All phases</option>
					{#each PHASES as p}
						<option value={p}>{PHASE_LABELS[p]}</option>
					{/each}
				</select>
			</div>
			<div class="modal-body">
				{#if libraryLoading}
					<p class="loading-text">Loading library…</p>
				{:else if filteredLibrary.length === 0}
					<p class="empty-text">No templates found</p>
				{:else}
					{#each filteredLibrary as tpl}
						<div class="library-item">
							<div class="library-info">
								<span class="library-name">{tpl.task_name}</span>
								<span class="library-meta">
									<span class="phase-pill" style="background: {PHASE_COLORS[tpl.phase]}">{tpl.phase}</span>
									{#if tpl.trade}
										<span class="trade-pill" style="background: {TRADE_COLORS[tpl.trade] || '#6b7280'}">{tpl.trade}</span>
									{/if}
									<span>{tpl.default_duration_days}d</span>
								</span>
							</div>
							<button class="btn btn-sm" on:click={() => addFromTemplate(tpl)}>Add</button>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.scope-builder {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
	}

	.deal-badge {
		background: #f3f4f6;
		color: #374151;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-family: monospace;
	}

	.save-indicator {
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		margin-left: auto;
	}
	.save-indicator.saving { background: #fef3c7; color: #92400e; }
	.save-indicator.saved { background: #d1fae5; color: #065f46; }
	.save-indicator.error { background: #fee2e2; color: #991b1b; }

	/* ── Cards ──────────────────────────────────────────────────────── */

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		background: #fff;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.card-header h2,
	.card h2 {
		font-size: 1.15rem;
		font-weight: 600;
		margin: 0 0 0.5rem 0;
	}

	.card-header h2 { margin-bottom: 0; }

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* ── Buttons ────────────────────────────────────────────────────── */

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.5rem 1.25rem;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		background: #fff;
		color: #374151;
		font-size: 0.875rem;
		cursor: pointer;
		font-weight: 500;
		transition: background 0.15s;
	}
	.btn:hover { background: #f3f4f6; }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-primary {
		background: #0066cc;
		color: #fff;
		border-color: #0066cc;
	}
	.btn-primary:hover { background: #0055aa; }

	.btn-sm {
		min-height: 36px;
		padding: 0.35rem 0.9rem;
		font-size: 0.8rem;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.75rem;
	}
	.icon-btn:hover { background: #f3f4f6; }
	.delete-btn:hover { background: #fee2e2; color: #dc2626; }

	/* ── CRM Section ───────────────────────────────────────────────── */

	.crm-summary {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}

	.crm-field {
		font-size: 0.9rem;
	}

	.crm-fields-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.5rem;
		margin-top: 0.75rem;
		max-height: 400px;
		overflow-y: auto;
		padding: 0.5rem;
		background: #f9fafb;
		border-radius: 6px;
	}

	.crm-field-item {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		padding: 0.35rem 0;
	}

	.crm-field-key {
		color: #6b7280;
		font-weight: 500;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.crm-field-value {
		color: #1f2937;
		word-break: break-word;
	}

	/* ── Phase Groups ──────────────────────────────────────────────── */

	.phase-group {
		margin-bottom: 0.5rem;
	}

	.phase-header {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 0.65rem 0.75rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		cursor: pointer;
		gap: 0.75rem;
		text-align: left;
	}
	.phase-header:hover { background: #f3f4f6; }

	.phase-name {
		font-weight: 600;
		font-size: 0.95rem;
	}

	.phase-count {
		color: #6b7280;
		font-size: 0.8rem;
	}

	.phase-toggle {
		margin-left: auto;
		font-size: 1rem;
		color: #9ca3af;
	}

	.phase-tasks {
		padding: 0.5rem 0 0.5rem 0.5rem;
	}

	/* ── Task Grid ─────────────────────────────────────────────────── */

	.task-grid-header {
		display: grid;
		grid-template-columns: 1fr 120px 60px 100px 80px;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		font-size: 0.7rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-weight: 600;
		border-bottom: 1px solid #e5e7eb;
	}

	.task-row {
		display: grid;
		grid-template-columns: 1fr 120px 60px 100px 80px;
		gap: 0.5rem;
		align-items: center;
		padding: 0.35rem 0.5rem;
		min-height: 44px;
		border-bottom: 1px solid #f3f4f6;
	}
	.task-row:hover { background: #fafbfc; }
	.task-row.editing { background: #eff6ff; }

	.task-row input[type="text"] {
		width: 100%;
		border: 1px solid transparent;
		border-radius: 4px;
		padding: 0.3rem 0.5rem;
		font-size: 0.875rem;
		background: transparent;
	}
	.task-row input[type="text"]:focus {
		border-color: #0066cc;
		background: #fff;
		outline: none;
	}

	.task-row input[type="number"] {
		width: 100%;
		border: 1px solid #e5e7eb;
		border-radius: 4px;
		padding: 0.3rem;
		font-size: 0.85rem;
		text-align: center;
	}

	.task-row select {
		width: 100%;
		border: 1px solid #e5e7eb;
		border-radius: 4px;
		padding: 0.2rem;
		font-size: 0.8rem;
		background: #fff;
	}

	.col-trade {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.trade-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.col-flags {
		display: flex;
		gap: 0.5rem;
	}

	.flag-label {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: #6b7280;
		cursor: pointer;
		white-space: nowrap;
	}

	.flag-label input[type="checkbox"] {
		width: 14px;
		height: 14px;
	}

	.col-actions {
		display: flex;
		gap: 0.15rem;
		justify-content: flex-end;
	}

	.task-detail-row {
		padding: 0 0.5rem 0.5rem 0.5rem;
	}

	.task-detail-row textarea {
		width: 100%;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0.5rem;
		font-size: 0.85rem;
		resize: vertical;
		font-family: inherit;
	}

	.add-task-btn {
		display: block;
		width: 100%;
		padding: 0.5rem;
		background: transparent;
		border: 1px dashed #d1d5db;
		border-radius: 6px;
		color: #6b7280;
		font-size: 0.85rem;
		cursor: pointer;
		margin-top: 0.25rem;
	}
	.add-task-btn:hover {
		background: #f9fafb;
		border-color: #0066cc;
		color: #0066cc;
	}

	/* ── Stats & Generate ──────────────────────────────────────────── */

	.stats-bar {
		display: flex;
		gap: 1.5rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 8px;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 80px;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
	}

	.stat-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.generate-controls {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.date-label {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		font-weight: 500;
		color: #374151;
		gap: 0.3rem;
	}

	.date-label input[type="date"] {
		min-height: 44px;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
	}

	.gen-error {
		padding: 0.75rem 1rem;
		background: #fee2e2;
		color: #991b1b;
		border-radius: 8px;
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
	}

	.gen-result {
		padding: 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
	}
	.gen-success { background: #d1fae5; color: #065f46; }
	.gen-fail { background: #fee2e2; color: #991b1b; }

	.gen-result p { margin: 0 0 0.3rem; }
	.gen-result code {
		background: rgba(0,0,0,0.08);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.8rem;
	}

	.gen-stats {
		display: flex;
		gap: 1rem;
		margin-top: 0.5rem;
		font-size: 0.8rem;
		opacity: 0.8;
	}

	/* ── Modal ─────────────────────────────────────────────────────── */

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 2rem;
	}

	.modal {
		background: #fff;
		border-radius: 12px;
		width: 100%;
		max-width: 640px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.modal-filters {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.modal-filters input {
		flex: 1;
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}

	.modal-filters select {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.4rem 0.5rem;
		font-size: 0.85rem;
	}

	.modal-body {
		overflow-y: auto;
		padding: 0.5rem 1.25rem 1.25rem;
	}

	.library-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0;
		border-bottom: 1px solid #f3f4f6;
	}
	.library-item:last-child { border-bottom: none; }

	.library-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.library-name {
		font-size: 0.9rem;
		font-weight: 500;
	}

	.library-meta {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.75rem;
		color: #6b7280;
	}

	.phase-pill,
	.trade-pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		color: #fff;
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	/* ── Utility ────────────────────────────────────────────────────── */

	.error-text { color: #dc2626; font-size: 0.875rem; }
	.loading-text { color: #6b7280; font-size: 0.875rem; }
	.empty-text { color: #9ca3af; font-size: 0.875rem; text-align: center; padding: 2rem 0; }

	/* ── Responsive ─────────────────────────────────────────────────── */

	@media (max-width: 720px) {
		.scope-builder { padding: 1rem; }

		.task-grid-header,
		.task-row {
			grid-template-columns: 1fr 90px 50px 80px 70px;
			gap: 0.3rem;
			font-size: 0.8rem;
		}

		.stats-bar { gap: 1rem; }
		.stat { min-width: 60px; }
		.stat-value { font-size: 1.2rem; }

		.crm-fields-grid { grid-template-columns: 1fr; }
		.crm-summary { flex-direction: column; gap: 0.5rem; }
	}
</style>
