<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	export let data: PageData;
	const dealId = data.dealId;

	// ── Types ────────────────────────────────────────────────────────────────

	interface Area {
		name: string;
		sqft?: number | null;
	}

	interface ScopeDefinition {
		deal_id: string;
		project_type: string;
		areas: Area[];
		included_items: string[];
		excluded_items: string[];
		selections_needed: string[];
		permit_required: boolean;
		long_lead_items: string[];
		special_conditions: Record<string, boolean | string>;
		trade_notes: string;
		status: string;
		updated_at?: string;
	}

	interface TaskTemplate {
		id: string;
		project_type: string;
		phase: string;
		task_name: string;
		trade: string | null;
		default_duration_days: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		material_lead_time_days: number;
		is_conditional: boolean;
		condition_key: string | null;
		condition_value: string | null;
		sort_order: number;
	}

	interface PreviewTask {
		task_name: string;
		phase: string;
		trade: string | null;
		default_duration_days: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		is_conditional: boolean;
	}

	interface PreviewData {
		totalTasks: number;
		tasks: PreviewTask[];
		scope?: { status?: string };
	}

	// ── State ────────────────────────────────────────────────────────────────

	const ALL_PHASES = ['preconstruction', 'demo', 'rough', 'finish', 'closeout'];
	const ALL_PROJECT_TYPES = ['hall_bath', 'primary_bath', 'kitchen', 'basement', 'deck'];

	const TRADE_COLORS: Record<string, { bg: string }> = {
		plumbing:   { bg: '#2563eb' },
		electrical: { bg: '#d97706' },
		tile:       { bg: '#059669' },
		paint:      { bg: '#7c3aed' },
		general:    { bg: '#6b7280' },
		hvac:       { bg: '#dc2626' },
		framing:    { bg: '#92400e' }
	};

	const STATUS_COLORS: Record<string, string> = {
		draft: '#9ca3af',
		reviewed: '#3b82f6',
		approved: '#059669',
		generated: '#7c3aed'
	};

	// Form fields
	let projectType = 'hall_bath';
	let areas: Area[] = [{ name: '', sqft: null }];

	let includedItems: string[] = [];
	let includedInput = '';
	let excludedItems: string[] = [];
	let excludedInput = '';
	let selectionsNeeded: string[] = [];
	let selectionsInput = '';
	let longLeadItems: string[] = [];
	let longLeadInput = '';

	let permitRequired = false;
	let conditionKeys: string[] = [];
	let specialConditions: Record<string, boolean> = {};

	let tradeNotes = '';
	let currentStatus = 'draft';

	// UI state
	let saving = false;
	let saveError = '';
	let saveSuccess = false;
	let statusChanging = false;

	let previewData: PreviewData | null = null;
	let previewLoading = false;
	let previewError = '';
	let generating = false;

	// Generation log state
	let latestGenLog: any = null;
	let genLogHistory: any[] = [];
	let genLogLoading = true;

	// ── Derived ──────────────────────────────────────────────────────────────

	$: previewTasks = previewData?.tasks ?? [];
	$: totalDays = previewTasks.reduce((s, t) => s + t.default_duration_days, 0);
	$: totalDecisions = previewTasks.filter((t) => t.requires_client_decision).length;
	$: totalInspections = previewTasks.filter((t) => t.requires_inspection).length;

	$: groupedPreview = (() => {
		const map = new Map<string, PreviewTask[]>();
		for (const phase of ALL_PHASES) {
			const tasks = previewTasks
				.filter((t) => t.phase === phase)
				.sort((a, b) => a.task_name.localeCompare(b.task_name));
			if (tasks.length) map.set(phase, tasks);
		}
		return map;
	})();

	// ── Init ─────────────────────────────────────────────────────────────────

	onMount(async () => {
		await Promise.all([loadScope(), loadPreview(), loadGenLogs()]);
	});

	async function loadScope() {
		try {
			const res = await fetch(`/api/admin/scope?dealId=${encodeURIComponent(dealId)}`);
			const json = await res.json();
			if (!res.ok) return;
			const scope: ScopeDefinition | null = json.data ?? null;
			if (scope) {
				populateForm(scope);
				await loadConditionKeys(scope.project_type);
			} else {
				await loadConditionKeys(projectType);
			}
		} catch {
			await loadConditionKeys(projectType);
		}
	}

	function populateForm(scope: ScopeDefinition) {
		projectType = scope.project_type ?? 'hall_bath';
		areas = scope.areas?.length ? scope.areas.map((a) => ({ name: a.name, sqft: a.sqft ?? null })) : [{ name: '', sqft: null }];
		includedItems = [...(scope.included_items ?? [])];
		excludedItems = [...(scope.excluded_items ?? [])];
		selectionsNeeded = [...(scope.selections_needed ?? [])];
		longLeadItems = [...(scope.long_lead_items ?? [])];
		permitRequired = scope.permit_required ?? false;
		tradeNotes = scope.trade_notes ?? '';
		currentStatus = scope.status ?? 'draft';

		const sc = scope.special_conditions ?? {};
		const raw: Record<string, boolean> = {};
		for (const [k, v] of Object.entries(sc)) {
			if (k !== 'permit_required') raw[k] = v === true || v === 'true';
		}
		specialConditions = raw;
	}

	async function loadConditionKeys(type: string) {
		try {
			const res = await fetch(`/api/admin/task-templates?projectType=${encodeURIComponent(type)}`);
			const json = await res.json();
			if (!res.ok) return;
			const templates: TaskTemplate[] = json.data ?? [];
			const keys = new Set<string>();
			for (const t of templates) {
				if (t.is_conditional && t.condition_key) keys.add(t.condition_key);
			}
			conditionKeys = [...keys].filter((k) => k !== 'permit_required');
			// ensure specialConditions has entries for each key
			const updated: Record<string, boolean> = {};
			for (const k of conditionKeys) {
				updated[k] = specialConditions[k] ?? false;
			}
			specialConditions = updated;
		} catch {
			// silently ignore
		}
	}

	async function loadPreview() {
		previewLoading = true;
		previewError = '';
		try {
			const res = await fetch(`/api/admin/scope/${encodeURIComponent(dealId)}/preview`);
			const json = await res.json();
			if (!res.ok) {
				// 404 means no scope yet — that's fine
				if (res.status !== 404) previewError = json.message || 'Preview failed';
				previewData = null;
				return;
			}
			previewData = json.data ?? null;
		} catch {
			previewData = null;
		} finally {
			previewLoading = false;
		}
	}

	async function loadGenLogs() {
		genLogLoading = true;
		try {
			const [latestRes, historyRes] = await Promise.all([
				fetch(`/api/admin/generation-log?dealId=${encodeURIComponent(dealId)}&latest=true`),
				fetch(`/api/admin/generation-log?dealId=${encodeURIComponent(dealId)}`)
			]);
			const latestJson = await latestRes.json();
			const historyJson = await historyRes.json();
			latestGenLog = latestJson.data ?? null;
			genLogHistory = historyJson.data ?? [];
		} catch {
			latestGenLog = null;
			genLogHistory = [];
		} finally {
			genLogLoading = false;
		}
	}

	// ── Project type change ───────────────────────────────────────────────────

	async function onTypeChange() {
		await loadConditionKeys(projectType);
	}

	// ── Areas ─────────────────────────────────────────────────────────────────

	function addArea() {
		areas = [...areas, { name: '', sqft: null }];
	}

	function removeArea(i: number) {
		areas = areas.filter((_, idx) => idx !== i);
		if (areas.length === 0) areas = [{ name: '', sqft: null }];
	}

	// ── Tag inputs ────────────────────────────────────────────────────────────

	function addTag(list: string[], value: string): string[] {
		const v = value.trim();
		if (v && !list.includes(v)) return [...list, v];
		return list;
	}

	function removeTag(list: string[], value: string): string[] {
		return list.filter((t) => t !== value);
	}

	function handleTagKey(
		e: KeyboardEvent & { currentTarget: HTMLInputElement },
		list: string[],
		setter: (v: string[]) => void,
		inputSetter: (v: string) => void
	) {
		if (e.key === 'Enter') {
			e.preventDefault();
			setter(addTag(list, e.currentTarget.value));
			inputSetter('');
		}
	}

	// ── Save ─────────────────────────────────────────────────────────────────

	async function saveScope() {
		saving = true;
		saveError = '';
		saveSuccess = false;
		try {
			const sc: Record<string, boolean | string> = { ...specialConditions };
			if (permitRequired) sc.permit_required = true;

			const body = {
				dealId: dealId,
				projectType: projectType,
				areas: areas.filter((a) => a.name.trim()).map((a) => ({
					name: a.name.trim(),
					...(a.sqft != null && a.sqft > 0 ? { sqft: a.sqft } : {})
				})),
				includedItems: includedItems,
				excludedItems: excludedItems,
				selectionsNeeded: selectionsNeeded,
				permitRequired: permitRequired,
				longLeadItems: longLeadItems,
				specialConditions: sc,
				tradeNotes: tradeNotes.trim() || null
			};

			const res = await fetch('/api/admin/scope', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Save failed');
			saveSuccess = true;
			setTimeout(() => (saveSuccess = false), 3000);
			await loadPreview();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	// ── Status transitions ────────────────────────────────────────────────────

	async function setStatus(status: string) {
		statusChanging = true;
		try {
			const res = await fetch(`/api/admin/scope/${encodeURIComponent(dealId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Status update failed');
			currentStatus = status;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Status update failed';
		} finally {
			statusChanging = false;
		}
	}

	async function handleGenerate() {
		if (generating) return;
		generating = true;

		try {
			const res = await fetch('/api/admin/scope/' + encodeURIComponent(dealId) + '/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Generation failed');
			if (json.data?.success === false) {
				throw new Error(json.data.error || 'Generation failed');
			}
			if (json.data?.success) {
				currentStatus = 'generated';
			}
			// Refresh generation logs to show the result
			await loadGenLogs();
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Generation failed');
		} finally {
			generating = false;
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function capitalize(s: string) {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function tradeBg(trade: string | null): string {
		if (!trade || !TRADE_COLORS[trade]) return '#e5e7eb';
		return TRADE_COLORS[trade].bg;
	}

	function fmtDateTime(value: string | null | undefined): string {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}

	function genLogStatusStyle(status: string): string {
		if (status === 'completed') return 'background:#dcfce7;color:#166534;';
		if (status === 'failed') return 'background:#fee2e2;color:#991b1b;';
		if (status === 'partial') return 'background:#ffedd5;color:#9a3412;';
		return 'background:#fef3c7;color:#92400e;';
	}

	function genLogStatusLabel(status: string): string {
		if (status === 'completed') return 'Completed';
		if (status === 'failed') return 'Failed';
		if (status === 'partial') return 'Partial';
		return 'In Progress';
	}
</script>

<div class="container">
	<!-- Header -->
	<div class="page-header">
		<a class="back-link" href="/admin/scope">← Back to Scope List</a>
		<h1>Scope Editor</h1>
		<p class="deal-id-label">{dealId}</p>
	</div>

	<div class="two-panel">
		<!-- ── LEFT: Form ─────────────────────────────────────────────────── -->
		<div class="form-panel">

			<!-- Section A: Project Details -->
			<div class="card">
				<h3>Project Details</h3>
				<div class="field">
					<label class="field-label" for="project-type">Project Type</label>
					<select
						id="project-type"
						class="select"
						bind:value={projectType}
						on:change={onTypeChange}
					>
						{#each ALL_PROJECT_TYPES as t}
							<option value={t}>{t.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- Section B: Areas -->
			<div class="card">
				<h3>Areas</h3>
				<div class="areas-list">
					{#each areas as area, i}
						<div class="area-row">
							<input
								class="input area-name-input"
								type="text"
								placeholder="Area name (e.g. Main Bath)"
								bind:value={area.name}
							/>
							<input
								class="input area-sqft-input"
								type="number"
								placeholder="sqft (optional)"
								min="0"
								bind:value={area.sqft}
							/>
							<button
								class="btn btn-icon"
								type="button"
								aria-label="Remove area"
								on:click={() => removeArea(i)}
							>
								✕
							</button>
						</div>
					{/each}
				</div>
				<button class="btn btn-outline" type="button" on:click={addArea}>
					+ Add Area
				</button>
			</div>

			<!-- Section C: Scope Items -->
			<div class="card">
				<h3>Scope Items</h3>
				<div class="scope-items-grid">
					<!-- Included -->
					<div class="tag-section">
						<h4 class="tag-heading">Included Items</h4>
						<div class="tags-container">
							{#each includedItems as tag}
								<span class="tag tag-included">
									{tag}
									<button
										class="tag-remove"
										type="button"
										aria-label="Remove {tag}"
										on:click={() => (includedItems = removeTag(includedItems, tag))}
									>✕</button>
								</span>
							{/each}
						</div>
						<div class="tag-input-row">
							<input
								class="input"
								type="text"
								placeholder="Type and press Enter"
								bind:value={includedInput}
								on:keydown={(e) => handleTagKey(e, includedItems, (v) => (includedItems = v), (v) => (includedInput = v))}
							/>
							<button
								class="btn btn-outline btn-sm"
								type="button"
								on:click={() => {
									includedItems = addTag(includedItems, includedInput);
									includedInput = '';
								}}
							>Add</button>
						</div>
						{#if conditionKeys.length > 0}
							<p class="helper-text">Common keys: {conditionKeys.join(', ')}</p>
						{/if}
					</div>

					<!-- Excluded -->
					<div class="tag-section">
						<h4 class="tag-heading">Excluded Items</h4>
						<div class="tags-container">
							{#each excludedItems as tag}
								<span class="tag tag-excluded">
									{tag}
									<button
										class="tag-remove"
										type="button"
										aria-label="Remove {tag}"
										on:click={() => (excludedItems = removeTag(excludedItems, tag))}
									>✕</button>
								</span>
							{/each}
						</div>
						<div class="tag-input-row">
							<input
								class="input"
								type="text"
								placeholder="Type and press Enter"
								bind:value={excludedInput}
								on:keydown={(e) => handleTagKey(e, excludedItems, (v) => (excludedItems = v), (v) => (excludedInput = v))}
							/>
							<button
								class="btn btn-outline btn-sm"
								type="button"
								on:click={() => {
									excludedItems = addTag(excludedItems, excludedInput);
									excludedInput = '';
								}}
							>Add</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Section D: Conditions -->
			<div class="card">
				<h3>Conditions</h3>
				<label class="checkbox-label permit-row">
					<input type="checkbox" bind:checked={permitRequired} />
					Permit Required
				</label>

				{#if conditionKeys.length > 0}
					<div class="conditions-list">
						{#each conditionKeys as key}
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={specialConditions[key]} />
								{key.replace(/_/g, ' ')}
							</label>
						{/each}
					</div>
				{:else}
					<p class="muted" style="margin-top:0.5rem;">Select a project type with templates to see conditions.</p>
				{/if}
			</div>

			<!-- Section E: Selections & Lead Times -->
			<div class="card">
				<h3>Selections &amp; Lead Times</h3>
				<div class="scope-items-grid">
					<!-- Selections needed -->
					<div class="tag-section">
						<h4 class="tag-heading">Selections Needed</h4>
						<div class="tags-container">
							{#each selectionsNeeded as tag}
								<span class="tag tag-selection">
									{tag}
									<button
										class="tag-remove"
										type="button"
										aria-label="Remove {tag}"
										on:click={() => (selectionsNeeded = removeTag(selectionsNeeded, tag))}
									>✕</button>
								</span>
							{/each}
						</div>
						<div class="tag-input-row">
							<input
								class="input"
								type="text"
								placeholder="Type and press Enter"
								bind:value={selectionsInput}
								on:keydown={(e) => handleTagKey(e, selectionsNeeded, (v) => (selectionsNeeded = v), (v) => (selectionsInput = v))}
							/>
							<button
								class="btn btn-outline btn-sm"
								type="button"
								on:click={() => {
									selectionsNeeded = addTag(selectionsNeeded, selectionsInput);
									selectionsInput = '';
								}}
							>Add</button>
						</div>
					</div>

					<!-- Long lead items -->
					<div class="tag-section">
						<h4 class="tag-heading">Long Lead Items</h4>
						<div class="tags-container">
							{#each longLeadItems as tag}
								<span class="tag tag-lead">
									{tag}
									<button
										class="tag-remove"
										type="button"
										aria-label="Remove {tag}"
										on:click={() => (longLeadItems = removeTag(longLeadItems, tag))}
									>✕</button>
								</span>
							{/each}
						</div>
						<div class="tag-input-row">
							<input
								class="input"
								type="text"
								placeholder="Type and press Enter"
								bind:value={longLeadInput}
								on:keydown={(e) => handleTagKey(e, longLeadItems, (v) => (longLeadItems = v), (v) => (longLeadInput = v))}
							/>
							<button
								class="btn btn-outline btn-sm"
								type="button"
								on:click={() => {
									longLeadItems = addTag(longLeadItems, longLeadInput);
									longLeadInput = '';
								}}
							>Add</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Section F: Notes -->
			<div class="card">
				<h3>Notes</h3>
				<div class="field">
					<label class="field-label" for="trade-notes">Trade Notes</label>
					<textarea
						id="trade-notes"
						class="textarea"
						rows="4"
						placeholder="Notes for trade partners about this scope..."
						bind:value={tradeNotes}
					></textarea>
				</div>
			</div>

			<!-- Section G: Status -->
			<div class="card">
				<h3>Status</h3>
				<div class="status-row">
					<span
						class="status-badge"
						style="background:{STATUS_COLORS[currentStatus] ?? '#9ca3af'};color:#fff;"
					>
						{currentStatus}
					</span>

					{#if currentStatus === 'draft'}
						<button
							class="btn btn-reviewed"
							on:click={() => setStatus('reviewed')}
							disabled={statusChanging}
						>
							Mark as Reviewed
						</button>
					{:else if currentStatus === 'reviewed'}
						<button
							class="btn btn-approved"
							on:click={() => setStatus('approved')}
							disabled={statusChanging}
						>
							Approve Scope
						</button>
					{:else if currentStatus === 'approved'}
						<span class="status-info">Scope approved — ready for project generation</span>
					{:else if currentStatus === 'generated'}
						<span class="status-info">✓ Project generated</span>
					{/if}
				</div>
			</div>

			<!-- Save -->
			{#if saveError}
				<p class="error-text">{saveError}</p>
			{/if}
			{#if saveSuccess}
				<p class="success-text">Scope saved successfully.</p>
			{/if}
			<button
				class="btn btn-primary btn-save"
				type="button"
				on:click={saveScope}
				disabled={saving}
			>
				{saving ? 'Saving…' : 'Save Scope'}
			</button>
		</div>

		<!-- ── RIGHT: Preview ─────────────────────────────────────────────── -->
		<div class="preview-panel">
			<div class="preview-sticky">
				<h2 class="preview-heading">Task Preview</h2>

				{#if previewLoading}
					<p class="muted">Loading preview…</p>
				{:else if previewData === null}
					<div class="preview-empty">Save scope to see task preview.</div>
				{:else}
					<!-- Summary bar -->
					<div class="summary-bar">
						<span><strong>{previewTasks.length}</strong> tasks</span>
						<span>·</span>
						<span><strong>{totalDays}</strong> days</span>
						<span>·</span>
						<span><strong>{totalDecisions}</strong> decisions</span>
						<span>·</span>
						<span><strong>{totalInspections}</strong> inspections</span>
					</div>

					<!-- Tasks by phase -->
					{#each ALL_PHASES as phase}
						{#if groupedPreview.has(phase)}
							{@const phaseTasks = groupedPreview.get(phase) ?? []}
							<div class="preview-phase">
								<div class="preview-phase-header">
									<span>{capitalize(phase)}</span>
									<span class="phase-count">{phaseTasks.length}</span>
								</div>
								{#each phaseTasks as task}
									<div class="preview-task-row">
										<span class="preview-task-name">{task.task_name}</span>
										<div class="preview-task-meta">
											{#if task.trade}
												<span
													class="preview-trade"
													style="background:{tradeBg(task.trade)};color:#fff;"
												>{task.trade}</span>
											{/if}
											<span class="preview-duration muted">{task.default_duration_days}d</span>
											{#if task.requires_client_decision}
												<span class="preview-flag flag-decision">Decision</span>
											{/if}
											{#if task.requires_inspection}
												<span class="preview-flag flag-inspect">Inspect</span>
											{/if}
											{#if task.is_conditional}
												<span class="preview-flag flag-conditional">Conditional</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
				{/each}
			{/if}

			<!-- Generation Status -->
			<div class="card gen-status-card">
				<h3>Generation Status</h3>

				{#if genLogLoading}
					<p class="muted">Loading…</p>
				{:else if latestGenLog === null}
					<p class="muted">Not yet generated.</p>
				{:else}
					<div class="gen-status-header">
						<span class="status-badge" style={genLogStatusStyle(latestGenLog.status)}>
							{genLogStatusLabel(latestGenLog.status)}
						</span>
						<span class="gen-progress muted">
							{latestGenLog.tasks_created ?? 0} / {latestGenLog.tasks_total ?? '?'} tasks
						</span>
					</div>

					<div class="gen-detail-list">
						<div class="gen-detail-row">
							<span class="gen-detail-label">Phases created</span>
							<span class="gen-detail-value">{latestGenLog.phases_created ?? 0}</span>
						</div>
						<div class="gen-detail-row">
							<span class="gen-detail-label">Tasklists created</span>
							<span class="gen-detail-value">{latestGenLog.tasklists_created ?? 0}</span>
						</div>
						<div class="gen-detail-row">
							<span class="gen-detail-label">Started</span>
							<span class="gen-detail-value">{fmtDateTime(latestGenLog.started_at)}</span>
						</div>
						<div class="gen-detail-row">
							<span class="gen-detail-label">Completed</span>
							<span class="gen-detail-value">{fmtDateTime(latestGenLog.completed_at)}</span>
						</div>
						<div class="gen-detail-row">
							<span class="gen-detail-label">Last step</span>
							<span class="gen-detail-value">{latestGenLog.last_completed_step ?? '—'}</span>
						</div>
					</div>

					{#if latestGenLog.status === 'failed' && latestGenLog.error_message}
						<div class="gen-error-box">{latestGenLog.error_message}</div>
					{/if}

					{#if latestGenLog.zoho_project_id}
						<p class="gen-zoho-link">
							Zoho Project:
							<a
								href="https://projects.zoho.com/portal/cprco#project/{latestGenLog.zoho_project_id}"
								target="_blank"
								rel="noopener noreferrer"
							>{latestGenLog.zoho_project_id}</a>
						</p>
					{/if}

					{#if genLogHistory.length > 0}
						<details class="gen-history-details">
							<summary class="gen-history-summary">
								Generation History ({genLogHistory.length})
							</summary>
							<div class="gen-history-list">
								{#each genLogHistory as log (log.id)}
									<div class="gen-history-row">
										<span class="gen-history-date muted">{fmtDateTime(log.started_at)}</span>
										<span class="status-badge gen-history-badge" style={genLogStatusStyle(log.status)}>
											{genLogStatusLabel(log.status)}
										</span>
										<span class="gen-history-tasks muted">
											{log.tasks_created ?? 0}/{log.tasks_total ?? '?'}
										</span>
									</div>
								{/each}
							</div>
						</details>
					{/if}
				{/if}

				{#if currentStatus === 'approved' || (currentStatus === 'generated' && latestGenLog?.status === 'failed')}
					<p class="gen-warning">This will create a real Zoho Projects project.</p>
					<button class="btn btn-generate" type="button" on:click={handleGenerate} disabled={generating}>
						{#if generating}
							Generating…
						{:else if latestGenLog?.status === 'failed'}
							Retry Generation
						{:else}
							Generate Zoho Project
						{/if}
					</button>
				{/if}

				<a
					class="btn btn-sow-link"
					href="/admin/scope/{dealId}/sow"
					target="_blank"
					rel="noopener noreferrer"
				>
					View Scope of Work
				</a>
			</div>
			</div>
		</div>
	</div>
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		margin-bottom: 1.75rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		color: #6b7280;
		text-decoration: none;
		font-size: 0.88rem;
		margin-bottom: 0.75rem;
	}

	.back-link:hover {
		color: #0066cc;
	}

	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.6rem;
		color: #111827;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
		color: #111827;
	}

	h3 {
		font-weight: 700;
		font-size: 1rem;
		margin: 0 0 0.75rem;
		color: #111827;
	}

	h4 {
		font-size: 0.88rem;
		font-weight: 700;
		color: #374151;
		margin: 0 0 0.5rem;
	}

	.tag-heading {
		font-size: 0.88rem;
		font-weight: 700;
		color: #374151;
		margin: 0 0 0.5rem;
	}

	.deal-id-label {
		font-size: 0.9rem;
		color: #6b7280;
		margin: 0;
		font-family: monospace;
	}

	/* Two-panel layout */
	.two-panel {
		display: grid;
		grid-template-columns: 1fr 380px;
		gap: 2rem;
		align-items: start;
	}

	/* Cards */
	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
		margin-bottom: 1rem;
	}

	/* Fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		display: block;
	}

	.input {
		border: 1px solid #ccc;
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.93rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
	}

	.input:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.input:disabled {
		background: #f3f4f6;
		color: #6b7280;
	}

	.select {
		border: 1px solid #ccc;
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.93rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		background: #fff;
		text-transform: capitalize;
	}

	.select:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.textarea {
		border: 1px solid #ccc;
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.93rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 100px;
		resize: vertical;
		font-family: inherit;
	}

	.textarea:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1.1rem;
		border: 1px solid #d0d0d0;
		border-radius: 999px;
		background: #fff;
		color: #1a1a1a;
		min-height: 44px;
		cursor: pointer;
		font-size: 0.93rem;
		white-space: nowrap;
	}

	.btn:hover:not(:disabled) {
		background: #f3f4f6;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-primary {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: #0055aa;
	}

	.btn-outline {
		border-color: #d0d0d0;
		background: #fff;
	}

	.btn-sm {
		min-height: 36px;
		padding: 0.3rem 0.85rem;
		font-size: 0.85rem;
	}

	.btn-icon {
		min-height: 36px;
		min-width: 36px;
		padding: 0;
		font-size: 0.85rem;
		flex-shrink: 0;
		border-radius: 999px;
	}

	.btn-reviewed {
		background: #3b82f6;
		border-color: #3b82f6;
		color: #fff;
	}

	.btn-reviewed:hover:not(:disabled) {
		background: #2563eb;
	}

	.btn-approved {
		background: #059669;
		border-color: #059669;
		color: #fff;
	}

	.btn-approved:hover:not(:disabled) {
		background: #047857;
	}

	.btn-save {
		width: 100%;
		font-size: 1rem;
		min-height: 48px;
		margin-bottom: 2rem;
	}

	/* Areas */
	.areas-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.area-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.area-name-input {
		flex: 2;
	}

	.area-sqft-input {
		flex: 1;
		min-width: 80px;
	}

	/* Scope items grid */
	.scope-items-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}

	/* Tags */
	.tag-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.tags-container {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		min-height: 2rem;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.25rem 0.75rem;
		font-size: 0.85rem;
		gap: 0.25rem;
	}

	.tag-included {
		background: #dcfce7;
		color: #166534;
	}

	.tag-excluded {
		background: #fee2e2;
		color: #991b1b;
	}

	.tag-selection {
		background: #e0e7ff;
		color: #3730a3;
	}

	.tag-lead {
		background: #fef3c7;
		color: #92400e;
	}

	.tag-remove {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		opacity: 0.6;
		font-size: 0.8rem;
		line-height: 1;
		display: inline-flex;
		align-items: center;
	}

	.tag-remove:hover {
		opacity: 1;
	}

	.tag-input-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.tag-input-row .input {
		flex: 1;
		min-height: 38px;
		padding: 0.45rem 0.75rem;
	}

	.helper-text {
		font-size: 0.78rem;
		color: #6b7280;
		margin: 0;
	}

	/* Conditions */
	.permit-row {
		margin-bottom: 0.75rem;
	}

	.conditions-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #374151;
		cursor: pointer;
		text-transform: capitalize;
		min-height: 28px;
	}

	/* Status */
	.status-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.status-info {
		font-size: 0.9rem;
		color: #374151;
	}

	/* Preview panel */
	.preview-panel {
		min-width: 0;
	}

	.preview-sticky {
		position: sticky;
		top: 5rem;
	}

	.preview-heading {
		font-size: 1.1rem;
		font-weight: 700;
		color: #111827;
		margin: 0 0 0.75rem;
	}

	.preview-empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 2rem 1rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
		font-size: 0.9rem;
	}

	.summary-bar {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		background: #f3f4f6;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		color: #374151;
		margin-bottom: 1rem;
	}

	.preview-phase {
		margin-bottom: 1rem;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		background: #fff;
		overflow: hidden;
	}

	.preview-phase-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.85rem;
		background: #f9fafb;
		border-bottom: 1px solid #e0e0e0;
		font-weight: 700;
		font-size: 0.82rem;
		color: #374151;
		text-transform: capitalize;
	}

	.phase-count {
		background: #e5e7eb;
		color: #374151;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.preview-task-row {
		padding: 0.5rem 0.85rem;
		border-bottom: 1px solid #f3f4f6;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.preview-task-row:last-child {
		border-bottom: none;
	}

	.preview-task-name {
		font-size: 0.85rem;
		font-weight: 500;
		color: #111827;
	}

	.preview-task-meta {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.preview-trade {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
	}

	.preview-duration {
		font-size: 0.75rem;
	}

	.preview-flag {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.flag-decision {
		background: #fef3c7;
		color: #92400e;
	}

	.flag-inspect {
		background: #e0f2fe;
		color: #0369a1;
	}

	.flag-conditional {
		background: #f3e8ff;
		color: #6b21a8;
	}

	/* Utilities */
	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0 0 0.5rem;
	}

	.success-text {
		color: #166534;
		font-size: 0.88rem;
		margin: 0 0 0.5rem;
	}

	/* Generation status */
	.gen-status-card {
		margin-top: 1.5rem;
	}

	.gen-status-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
		flex-wrap: wrap;
	}

	.gen-progress {
		font-size: 0.88rem;
	}

	.gen-detail-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
	}

	.gen-detail-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.85rem;
		border-bottom: 1px solid #f3f4f6;
		padding-bottom: 0.3rem;
	}

	.gen-detail-row:last-child {
		border-bottom: none;
	}

	.gen-detail-label {
		color: #6b7280;
		flex-shrink: 0;
	}

	.gen-detail-value {
		color: #111827;
		text-align: right;
		word-break: break-all;
	}

	.gen-error-box {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 6px;
		padding: 0.75rem;
		color: #991b1b;
		font-size: 0.85rem;
		margin-bottom: 0.85rem;
	}

	.gen-zoho-link {
		font-size: 0.85rem;
		color: #374151;
		margin: 0 0 0.85rem;
	}

	.gen-zoho-link a {
		color: #0066cc;
	}

	.gen-history-details {
		border-top: 1px solid #e0e0e0;
		padding-top: 0.75rem;
		margin-bottom: 0.85rem;
	}

	.gen-history-summary {
		font-size: 0.85rem;
		font-weight: 600;
		color: #374151;
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.gen-history-summary::-webkit-details-marker {
		display: none;
	}

	.gen-history-summary::before {
		content: '▶ ';
		font-size: 0.65rem;
		color: #6b7280;
	}

	details[open] > .gen-history-summary::before {
		content: '▼ ';
	}

	.gen-history-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.gen-history-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
	}

	.gen-history-date {
		flex: 1;
		min-width: 0;
	}

	.gen-history-badge {
		padding: 0.1rem 0.4rem;
		font-size: 0.7rem;
	}

	.gen-history-tasks {
		font-size: 0.8rem;
	}

	.btn-generate {
		width: 100%;
		min-height: 44px;
		border-radius: 999px;
		background: #0066cc;
		color: #fff;
		border: none;
		cursor: pointer;
		font-size: 0.93rem;
		font-weight: 700;
		margin-top: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-generate:disabled {
		background: #9ca3af;
		cursor: not-allowed;
	}

	.gen-warning {
		font-size: 0.82rem;
		color: #b45309;
		margin: 0.5rem 0 0.25rem;
	}

	.btn-sow-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 44px;
		border-radius: 999px;
		background: #f5f5f5;
		color: #1a1a1a;
		border: 1px solid #d0d0d0;
		font-size: 0.93rem;
		font-weight: 700;
		text-decoration: none;
		margin-top: 0.5rem;
	}

	.btn-sow-link:hover {
		background: #e8e8e8;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.two-panel {
			grid-template-columns: 1fr;
		}

		.preview-sticky {
			position: static;
		}

		.scope-items-grid {
			grid-template-columns: 1fr;
		}

		.area-row {
			flex-wrap: wrap;
		}

		.area-sqft-input {
			flex: 1 1 80px;
		}

		.btn-save {
			margin-bottom: 1.5rem;
		}
	}
</style>
