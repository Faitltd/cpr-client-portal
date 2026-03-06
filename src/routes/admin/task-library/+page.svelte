<script lang="ts">
	import { onMount } from 'svelte';

	interface TaskTemplate {
		id: string;
		project_type: string;
		phase: string;
		task_name: string;
		trade: string | null;
		description: string | null;
		default_duration_days: number;
		dependency_key: string | null;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		material_lead_time_days: number;
		sort_order: number;
		is_conditional: boolean;
		condition_key: string | null;
		condition_value: string | null;
		active: boolean;
		created_at: string;
	}

	const ALL_PROJECT_TYPES = ['hall_bath', 'primary_bath', 'kitchen', 'basement', 'deck'];
	const ALL_PHASES = ['preconstruction', 'demo', 'rough', 'finish', 'closeout'];

	const TRADE_COLORS: Record<string, { bg: string; color: string }> = {
		plumbing:   { bg: '#2563eb', color: '#fff' },
		electrical: { bg: '#d97706', color: '#fff' },
		tile:       { bg: '#059669', color: '#fff' },
		paint:      { bg: '#7c3aed', color: '#fff' },
		general:    { bg: '#6b7280', color: '#fff' },
		hvac:       { bg: '#dc2626', color: '#fff' },
		framing:    { bg: '#92400e', color: '#fff' }
	};

	let selectedType = 'hall_bath';
	let templates: TaskTemplate[] = [];
	let loading = false;
	let loadError = '';

	// Edit state — flat vars for binding (avoids object mutation issues)
	let editingId = '';
	let editTaskName = '';
	let editTrade = '';
	let editDescription = '';
	let editDurationDays = 1;
	let editDependencyKey = '';
	let editSortOrder = 0;
	let editRequiresInspection = false;
	let editRequiresClientDecision = false;
	let editMaterialLeadTime = 0;
	let editIsConditional = false;
	let editConditionKey = '';
	let editConditionValue = '';
	let saving = false;
	let saveError = '';

	// Create form state
	let createPhase = 'preconstruction';
	let createTaskName = '';
	let createTrade = '';
	let createDescription = '';
	let createDurationDays = 1;
	let createDependencyKey = '';
	let createSortOrder = 0;
	let createRequiresInspection = false;
	let createRequiresClientDecision = false;
	let createMaterialLeadTime = 0;
	let createIsConditional = false;
	let createConditionKey = '';
	let createConditionValue = '';
	let creating = false;
	let createError = '';
	let createSuccess = false;

	$: groupedTemplates = (() => {
		const map = new Map<string, TaskTemplate[]>();
		for (const phase of ALL_PHASES) {
			const tasks = templates
				.filter((t) => t.phase === phase)
				.sort((a, b) => a.sort_order - b.sort_order || a.task_name.localeCompare(b.task_name));
			if (tasks.length > 0) map.set(phase, tasks);
		}
		return map;
	})();

	onMount(async () => {
		await fetchTemplates(selectedType);
	});

	async function selectType(type: string) {
		if (type === selectedType) return;
		selectedType = type;
		editingId = '';
		createSuccess = false;
		await fetchTemplates(type);
	}

	async function fetchTemplates(type: string) {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/task-templates?projectType=${encodeURIComponent(type)}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.message || 'Failed to load');
			templates = data.data ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load templates';
			templates = [];
		} finally {
			loading = false;
		}
	}

	function startEdit(t: TaskTemplate) {
		editingId = t.id;
		saveError = '';
		editTaskName = t.task_name;
		editTrade = t.trade ?? '';
		editDescription = t.description ?? '';
		editDurationDays = t.default_duration_days;
		editDependencyKey = t.dependency_key ?? '';
		editSortOrder = t.sort_order;
		editRequiresInspection = t.requires_inspection;
		editRequiresClientDecision = t.requires_client_decision;
		editMaterialLeadTime = t.material_lead_time_days;
		editIsConditional = t.is_conditional;
		editConditionKey = t.condition_key ?? '';
		editConditionValue = t.condition_value ?? '';
	}

	function cancelEdit() {
		editingId = '';
		saveError = '';
	}

	async function saveEdit() {
		if (!editingId || !editTaskName.trim()) return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch(`/api/admin/task-templates/${editingId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					taskName: editTaskName.trim(),
					trade: editTrade || null,
					description: editDescription || null,
					defaultDurationDays: editDurationDays,
					dependencyKey: editDependencyKey || null,
					sortOrder: editSortOrder,
					requiresInspection: editRequiresInspection,
					requiresClientDecision: editRequiresClientDecision,
					materialLeadTimeDays: editMaterialLeadTime,
					isConditional: editIsConditional,
					conditionKey: editIsConditional ? (editConditionKey || null) : null,
					conditionValue: editIsConditional ? (editConditionValue || null) : null
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message || 'Update failed');
			editingId = '';
			await fetchTemplates(selectedType);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Update failed';
		} finally {
			saving = false;
		}
	}

	async function deactivate(t: TaskTemplate) {
		if (!window.confirm(`Deactivate '${t.task_name}'? It won't appear in future scope mappings.`)) return;
		try {
			const res = await fetch(`/api/admin/task-templates/${t.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json();
				alert(data.message || 'Deactivate failed');
				return;
			}
			if (editingId === t.id) editingId = '';
			await fetchTemplates(selectedType);
		} catch {
			alert('Deactivate failed');
		}
	}

	async function submitCreate() {
		if (!createTaskName.trim()) return;
		creating = true;
		createError = '';
		createSuccess = false;
		try {
			const body: Record<string, unknown> = {
				projectType: selectedType,
				phase: createPhase,
				taskName: createTaskName.trim(),
				defaultDurationDays: createDurationDays,
				sortOrder: createSortOrder,
				requiresInspection: createRequiresInspection,
				requiresClientDecision: createRequiresClientDecision,
				materialLeadTimeDays: createMaterialLeadTime,
				isConditional: createIsConditional
			};
			if (createTrade) body.trade = createTrade;
			if (createDescription.trim()) body.description = createDescription.trim();
			if (createDependencyKey.trim()) body.dependencyKey = createDependencyKey.trim();
			if (createIsConditional && createConditionKey.trim()) body.conditionKey = createConditionKey.trim();
			if (createIsConditional && createConditionValue.trim()) body.conditionValue = createConditionValue.trim();

			const res = await fetch('/api/admin/task-templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message || 'Create failed');

			// Reset form
			createPhase = 'preconstruction';
			createTaskName = '';
			createTrade = '';
			createDescription = '';
			createDurationDays = 1;
			createDependencyKey = '';
			createSortOrder = 0;
			createRequiresInspection = false;
			createRequiresClientDecision = false;
			createMaterialLeadTime = 0;
			createIsConditional = false;
			createConditionKey = '';
			createConditionValue = '';
			createSuccess = true;
			await fetchTemplates(selectedType);
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Create failed';
		} finally {
			creating = false;
		}
	}

	function capitalize(str: string) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	function tradeBadgeStyle(trade: string | null): string {
		if (!trade || !TRADE_COLORS[trade]) return 'background:#e5e7eb;color:#374151;';
		const c = TRADE_COLORS[trade];
		return `background:${c.bg};color:${c.color};`;
	}
</script>

<div class="container">
	<h1>Task Library</h1>
	<p class="subtitle">Master task catalog for scope-to-project automation</p>

	<!-- Section 1 — Project type selector -->
	<div class="type-selector">
		{#each ALL_PROJECT_TYPES as type}
			<button
				class="type-pill"
				class:active={selectedType === type}
				on:click={() => selectType(type)}
			>
				{type.replace(/_/g, ' ')}
			</button>
		{/each}
	</div>

	<!-- Section 2 — Templates by phase -->
	{#if loading}
		<p class="muted loading-msg">Loading…</p>
	{:else if loadError}
		<p class="error-text">{loadError}</p>
	{:else if templates.length === 0}
		<!-- Section 6 — Empty state -->
		<div class="empty">
			No templates for <strong>{selectedType.replace(/_/g, ' ')}</strong> yet. Add your first template below.
		</div>
	{:else}
		{#each ALL_PHASES as phase}
			{#if groupedTemplates.has(phase)}
				{@const phaseTasks = groupedTemplates.get(phase) ?? []}
				<details open>
					<summary class="phase-header">
						<span class="phase-name">{capitalize(phase)}</span>
						<span class="phase-count">({phaseTasks.length})</span>
					</summary>

					<div class="phase-body">
						{#each phaseTasks as t (t.id)}
							<!-- Template row -->
							<div class="template-row" class:editing={editingId === t.id}>
								<span class="row-sort muted">#{t.sort_order}</span>

								<div class="row-name">
									<span class="task-name">{t.task_name}</span>
									{#if t.is_conditional && t.condition_key}
										<span class="muted condition-text">
											Condition: {t.condition_key} = {t.condition_value}
										</span>
									{/if}
								</div>

								<span class="trade-badge" style={tradeBadgeStyle(t.trade)}>
									{t.trade ?? '—'}
								</span>

								<span class="row-info muted">{t.default_duration_days} days</span>

								<span class="row-dep muted" title={t.dependency_key ?? ''}>
									→ {t.dependency_key ?? '—'}
								</span>

								<div class="flag-row">
									{#if t.requires_inspection}
										<span class="flag flag-inspection">Inspection</span>
									{/if}
									{#if t.requires_client_decision}
										<span class="flag flag-decision">Decision</span>
									{/if}
									{#if t.material_lead_time_days > 0}
										<span class="flag flag-lead">Lead: {t.material_lead_time_days}d</span>
									{/if}
								</div>

								<div class="row-actions">
									<button
										class="btn btn-sm"
										on:click={() => editingId === t.id ? cancelEdit() : startEdit(t)}
									>
										{editingId === t.id ? 'Cancel' : 'Edit'}
									</button>
									<button
										class="btn btn-sm btn-destructive"
										on:click={() => deactivate(t)}
									>
										Deactivate
									</button>
								</div>
							</div>

							<!-- Section 3 — Inline edit form -->
							{#if editingId === t.id}
								<div class="edit-form">
									<div class="field-row">
										<div class="field field-grow">
											<label class="field-label" for="edit-task-name">
												Task Name <span class="required">*</span>
											</label>
											<input
												id="edit-task-name"
												class="input"
												type="text"
												bind:value={editTaskName}
											/>
										</div>
										<div class="field">
											<label class="field-label" for="edit-trade">Trade</label>
											<select id="edit-trade" class="select" bind:value={editTrade}>
												<option value="">— none —</option>
												<option value="plumbing">Plumbing</option>
												<option value="electrical">Electrical</option>
												<option value="tile">Tile</option>
												<option value="paint">Paint</option>
												<option value="general">General</option>
												<option value="hvac">HVAC</option>
												<option value="framing">Framing</option>
											</select>
										</div>
									</div>

									<div class="field" style="margin-bottom:1rem;">
										<label class="field-label" for="edit-description">Description</label>
										<textarea
											id="edit-description"
											class="textarea"
											rows="2"
											bind:value={editDescription}
										></textarea>
									</div>

									<div class="field-row">
										<div class="field">
											<label class="field-label" for="edit-duration">Duration (days)</label>
											<input
												id="edit-duration"
												class="input"
												type="number"
												min="0"
												bind:value={editDurationDays}
											/>
										</div>
										<div class="field">
											<label class="field-label" for="edit-sort">Sort Order</label>
											<input
												id="edit-sort"
												class="input"
												type="number"
												bind:value={editSortOrder}
											/>
										</div>
										<div class="field">
											<label class="field-label" for="edit-lead">Lead Time (days)</label>
											<input
												id="edit-lead"
												class="input"
												type="number"
												min="0"
												bind:value={editMaterialLeadTime}
											/>
										</div>
										<div class="field field-grow">
											<label class="field-label" for="edit-dep">Dependency Key</label>
											<input
												id="edit-dep"
												class="input"
												type="text"
												placeholder="task_name of predecessor"
												bind:value={editDependencyKey}
											/>
										</div>
									</div>

									<div class="field-row checkbox-row">
										<label class="checkbox-label">
											<input type="checkbox" bind:checked={editRequiresInspection} />
											Requires Inspection
										</label>
										<label class="checkbox-label">
											<input type="checkbox" bind:checked={editRequiresClientDecision} />
											Requires Client Decision
										</label>
										<label class="checkbox-label">
											<input type="checkbox" bind:checked={editIsConditional} />
											Conditional
										</label>
									</div>

									{#if editIsConditional}
										<div class="field-row">
											<div class="field">
												<label class="field-label" for="edit-ckey">Condition Key</label>
												<input
													id="edit-ckey"
													class="input"
													type="text"
													placeholder="e.g. plumbing_relocation"
													bind:value={editConditionKey}
												/>
											</div>
											<div class="field">
												<label class="field-label" for="edit-cval">Condition Value</label>
												<input
													id="edit-cval"
													class="input"
													type="text"
													placeholder="e.g. true"
													bind:value={editConditionValue}
												/>
											</div>
										</div>
									{/if}

									{#if saveError}
										<p class="error-text">{saveError}</p>
									{/if}

									<div class="form-footer">
										<button
											class="btn btn-primary"
											on:click={saveEdit}
											disabled={saving || !editTaskName.trim()}
										>
											{saving ? 'Saving…' : 'Save Changes'}
										</button>
										<button class="btn" on:click={cancelEdit} disabled={saving}>
											Cancel
										</button>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</details>
			{/if}
		{/each}
	{/if}

	<!-- Section 5 — Add New Template -->
	<div class="card add-card">
		<h2>Add New Template</h2>
		<form on:submit|preventDefault={submitCreate}>
			<div class="field-row">
				<div class="field">
					<label class="field-label">Project Type</label>
					<input class="input" type="text" value={selectedType} disabled />
				</div>
				<div class="field">
					<label class="field-label" for="create-phase">
						Phase <span class="required">*</span>
					</label>
					<select id="create-phase" class="select" bind:value={createPhase}>
						{#each ALL_PHASES as p}
							<option value={p}>{capitalize(p)}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="field-row">
				<div class="field field-grow">
					<label class="field-label" for="create-task-name">
						Task Name <span class="required">*</span>
					</label>
					<input
						id="create-task-name"
						class="input"
						type="text"
						placeholder="e.g. Install backer board"
						bind:value={createTaskName}
						required
					/>
				</div>
				<div class="field">
					<label class="field-label" for="create-trade">Trade</label>
					<select id="create-trade" class="select" bind:value={createTrade}>
						<option value="">— none —</option>
						<option value="plumbing">Plumbing</option>
						<option value="electrical">Electrical</option>
						<option value="tile">Tile</option>
						<option value="paint">Paint</option>
						<option value="general">General</option>
						<option value="hvac">HVAC</option>
						<option value="framing">Framing</option>
					</select>
				</div>
			</div>

			<div class="field" style="margin-bottom:1rem;">
				<label class="field-label" for="create-description">Description</label>
				<textarea
					id="create-description"
					class="textarea"
					rows="2"
					bind:value={createDescription}
				></textarea>
			</div>

			<div class="field-row">
				<div class="field">
					<label class="field-label" for="create-duration">Duration (days)</label>
					<input
						id="create-duration"
						class="input"
						type="number"
						min="0"
						bind:value={createDurationDays}
					/>
				</div>
				<div class="field">
					<label class="field-label" for="create-sort">Sort Order</label>
					<input id="create-sort" class="input" type="number" bind:value={createSortOrder} />
				</div>
				<div class="field">
					<label class="field-label" for="create-lead">Lead Time (days)</label>
					<input
						id="create-lead"
						class="input"
						type="number"
						min="0"
						bind:value={createMaterialLeadTime}
					/>
				</div>
				<div class="field field-grow">
					<label class="field-label" for="create-dep">Dependency Key</label>
					<input
						id="create-dep"
						class="input"
						type="text"
						placeholder="task_name of predecessor"
						bind:value={createDependencyKey}
					/>
				</div>
			</div>

			<div class="field-row checkbox-row">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={createRequiresInspection} />
					Requires Inspection
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={createRequiresClientDecision} />
					Requires Client Decision
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={createIsConditional} />
					Conditional
				</label>
			</div>

			{#if createIsConditional}
				<div class="field-row">
					<div class="field">
						<label class="field-label" for="create-ckey">Condition Key</label>
						<input
							id="create-ckey"
							class="input"
							type="text"
							placeholder="e.g. plumbing_relocation"
							bind:value={createConditionKey}
						/>
					</div>
					<div class="field">
						<label class="field-label" for="create-cval">Condition Value</label>
						<input
							id="create-cval"
							class="input"
							type="text"
							placeholder="e.g. true"
							bind:value={createConditionValue}
						/>
					</div>
				</div>
			{/if}

			{#if createError}
				<p class="error-text">{createError}</p>
			{/if}
			{#if createSuccess}
				<p class="success-text">Template created successfully.</p>
			{/if}

			<div class="form-footer">
				<button
					class="btn btn-primary"
					type="submit"
					disabled={creating || !createTaskName.trim()}
				>
					{creating ? 'Creating…' : 'Add Template'}
				</button>
			</div>
		</form>
	</div>
</div>

<style>
	.container {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.6rem;
		color: #111827;
	}

	h2 {
		margin: 0 0 1.25rem;
		font-size: 1.1rem;
		color: #111827;
	}

	.subtitle {
		margin: 0 0 1.75rem;
		color: #6b7280;
		font-size: 0.95rem;
	}

	/* Project type pills */
	.type-selector {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 2rem;
	}

	.type-pill {
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
		text-transform: capitalize;
		white-space: nowrap;
	}

	.type-pill:hover:not(.active) {
		background: #f3f4f6;
	}

	.type-pill.active {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
		font-weight: 600;
	}

	/* Phase sections */
	details {
		margin-bottom: 1.5rem;
	}

	.phase-header {
		font-size: 1.1rem;
		font-weight: 700;
		text-transform: capitalize;
		border-bottom: 2px solid #0066cc;
		padding-bottom: 0.5rem;
		margin: 0 0 0;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		list-style: none;
		user-select: none;
		color: #111827;
	}

	.phase-header::-webkit-details-marker {
		display: none;
	}

	.phase-header::before {
		content: '▶';
		font-size: 0.6rem;
		color: #0066cc;
		flex-shrink: 0;
	}

	details[open] > .phase-header::before {
		content: '▼';
	}

	.phase-count {
		font-weight: 400;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.phase-body {
		border: 1px solid #e0e0e0;
		border-top: none;
		border-radius: 0 0 8px 8px;
		background: #fff;
		overflow: hidden;
	}

	/* Template rows */
	.template-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid #f3f4f6;
		flex-wrap: wrap;
	}

	.template-row:last-of-type {
		border-bottom: none;
	}

	.template-row.editing {
		background: #f0f7ff;
	}

	.row-sort {
		font-size: 0.77rem;
		min-width: 2.2rem;
		text-align: right;
		flex-shrink: 0;
	}

	.row-name {
		flex: 1;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.task-name {
		font-weight: 600;
		color: #111827;
		font-size: 0.93rem;
	}

	.condition-text {
		font-size: 0.79rem;
	}

	.trade-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.76rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.row-info {
		font-size: 0.82rem;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.row-dep {
		font-size: 0.82rem;
		white-space: nowrap;
		flex-shrink: 0;
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.flag-row {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	.flag {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		font-size: 0.73rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.flag-inspection {
		background: #e0f2fe;
		color: #0369a1;
	}

	.flag-decision {
		background: #fef3c7;
		color: #92400e;
	}

	.flag-lead {
		background: #f3e8ff;
		color: #6b21a8;
	}

	.row-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
		margin-left: auto;
	}

	/* Inline edit form */
	.edit-form {
		background: #f8fafc;
		border-left: 3px solid #0066cc;
		border-bottom: 1px solid #e0e0e0;
		padding: 1.25rem 1.25rem 1rem;
	}

	/* Add card */
	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.add-card {
		margin-top: 2.5rem;
	}

	/* Form fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
	}

	.field-grow {
		flex: 2;
	}

	.field-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #374151;
		display: block;
	}

	.required {
		color: #b91c1c;
	}

	.input {
		border: 1px solid #d1d5db;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font-size: 0.93rem;
		min-height: 44px;
		width: 100%;
		box-sizing: border-box;
	}

	.input:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.input:disabled {
		background: #f3f4f6;
		color: #6b7280;
		cursor: not-allowed;
	}

	.select {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.93rem;
		min-height: 44px;
		background: #fff;
		width: 100%;
		box-sizing: border-box;
	}

	.select:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.textarea {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		font-size: 0.93rem;
		resize: vertical;
		width: 100%;
		box-sizing: border-box;
		font-family: inherit;
	}

	.textarea:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.checkbox-row {
		align-items: center;
		gap: 1.5rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.9rem;
		color: #374151;
		cursor: pointer;
		white-space: nowrap;
		flex: unset;
		min-height: 44px;
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

	.btn-sm {
		padding: 0.3rem 0.8rem;
		font-size: 0.82rem;
		min-height: 36px;
	}

	.btn-primary {
		background: #0066cc;
		border-color: #0066cc;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: #0055aa;
	}

	.btn-destructive {
		background: #dc2626;
		border-color: #dc2626;
		color: #fff;
	}

	.btn-destructive:hover:not(:disabled) {
		background: #b91c1c;
	}

	.form-footer {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		margin-top: 0.75rem;
	}

	/* Utilities */
	.muted {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.loading-msg {
		padding: 2rem 0;
	}

	.error-text {
		color: #b91c1c;
		font-size: 0.88rem;
		margin: 0.5rem 0 0;
	}

	.success-text {
		color: #166534;
		font-size: 0.88rem;
		margin: 0.5rem 0 0;
	}

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
		margin-bottom: 2rem;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.type-selector {
			gap: 0.4rem;
		}

		.template-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
			padding: 1rem;
		}

		.row-name {
			width: 100%;
			min-width: 0;
		}

		.row-actions {
			margin-left: 0;
			width: 100%;
		}

		.row-actions .btn {
			flex: 1;
		}

		.field-row {
			flex-direction: column;
		}

		.field {
			min-width: 100%;
		}

		.checkbox-row {
			flex-direction: column;
			gap: 0.25rem;
		}

		.form-footer {
			flex-direction: column;
		}

		.form-footer .btn {
			width: 100%;
		}
	}
</style>
