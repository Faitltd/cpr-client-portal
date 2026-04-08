<script lang="ts">
	interface LeadSummary {
		id: string;
		First_Name: string | null;
		Last_Name: string | null;
		Email: string | null;
		Phone: string | null;
		Lead_Status: string | null;
		Company: string | null;
	}

	interface LeadDetail {
		id: string;
		First_Name: string | null;
		Last_Name: string | null;
		Email: string | null;
		Phone: string | null;
		Lead_Status: string | null;
		Company: string | null;
		Disco_Call: string | null;
		Description: string | null;
		Property_Type: string | null;
		What_are_the_must_have_features: string | null;
		Budget_Range: string | null;
		Decision_Makers: string | null;
		Reside_During_Construction: string | null;
		Photos: string | null;
		Image_Upload_4: string | null;
		Unqualified: boolean;
		Prior_Renovations: string | null;
		What_level_of_finishes_are_you_aiming_for: string | null;
		File_Upload_1: string | null;
		Selections_Availability: string | null;
		Access_Notes: string | null;
		Timeline: string | null;
		Project_Details_Cont_d: string | null;
	}

	const FIELD_DEFS: Array<{
		key: keyof LeadDetail;
		label: string;
		type: 'text' | 'textarea' | 'picklist' | 'boolean' | 'readonly';
		options?: string[];
	}> = [
		{ key: 'Disco_Call', label: 'Disco Call Notes', type: 'textarea' },
		{ key: 'Property_Type', label: 'Property Type', type: 'picklist', options: ['-None-', 'Primary Residence', 'Vacation Home', 'Investment Property'] },
		{ key: 'What_are_the_must_have_features', label: 'Priorities', type: 'text' },
		{ key: 'Budget_Range', label: 'Budget Range', type: 'text' },
		{ key: 'Decision_Makers', label: 'Decision Makers', type: 'text' },
		{ key: 'Reside_During_Construction', label: 'Reside During Construction?', type: 'text' },
		{ key: 'Unqualified', label: 'Unqualified', type: 'boolean' },
		{ key: 'Prior_Renovations', label: 'Prior Renovations', type: 'text' },
		{ key: 'What_level_of_finishes_are_you_aiming_for', label: 'Level of Finish', type: 'text' },
		{ key: 'Selections_Availability', label: 'Selections Availability', type: 'text' },
		{ key: 'Access_Notes', label: 'Access Notes', type: 'text' },
		{ key: 'Timeline', label: 'Timeline', type: 'text' },
		{ key: 'Project_Details_Cont_d', label: 'Form Entry', type: 'textarea' },
		{ key: 'Photos', label: 'Photos', type: 'readonly' },
		{ key: 'Image_Upload_4', label: 'Photos 2', type: 'readonly' },
		{ key: 'File_Upload_1', label: 'Designs', type: 'readonly' },
	];

	let leads: LeadSummary[] = [];
	let listLoading = true;
	let listError = '';

	let selectedId = '';
	let detail: LeadDetail | null = null;
	let detailLoading = false;
	let detailError = '';

	let edited: Record<string, unknown> = {};
	let saving = false;
	let saveMessage = '';
	let saveOk = false;

	let search = '';

	$: filtered = search
		? leads.filter(l => {
			const q = search.toLowerCase();
			const name = `${l.First_Name || ''} ${l.Last_Name || ''}`.toLowerCase();
			return name.includes(q)
				|| (l.Email || '').toLowerCase().includes(q)
				|| (l.Phone || '').includes(q)
				|| (l.Company || '').toLowerCase().includes(q);
		})
		: leads;

	async function loadLeads() {
		listLoading = true;
		listError = '';
		try {
			const r = await fetch('/api/admin/leads');
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			leads = j.data ?? [];
		} catch (e) {
			listError = e instanceof Error ? e.message : 'Failed to load leads';
		} finally {
			listLoading = false;
		}
	}

	async function selectLead(id: string) {
		selectedId = id;
		detail = null;
		edited = {};
		saveMessage = '';
		detailLoading = true;
		detailError = '';
		try {
			const r = await fetch(`/api/admin/leads?id=${encodeURIComponent(id)}`);
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Failed');
			detail = j.data;
		} catch (e) {
			detailError = e instanceof Error ? e.message : 'Failed to load lead';
		} finally {
			detailLoading = false;
		}
	}

	function handleEdit(key: string, value: unknown) {
		edited = { ...edited, [key]: value };
	}

	function fieldValue(key: keyof LeadDetail): unknown {
		if (key in edited) return edited[key];
		if (!detail) return '';
		return detail[key] ?? '';
	}

	$: hasChanges = Object.keys(edited).length > 0;

	async function save() {
		if (!detail || !hasChanges) return;
		saving = true;
		saveMessage = '';
		try {
			const r = await fetch('/api/admin/leads', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: detail.id, ...edited })
			});
			const j = await r.json();
			if (!r.ok) throw new Error(j.message || 'Update failed');
			saveOk = true;
			saveMessage = 'Saved successfully.';
			// Merge edits back into detail
			detail = { ...detail, ...edited } as LeadDetail;
			edited = {};
		} catch (e) {
			saveOk = false;
			saveMessage = e instanceof Error ? e.message : 'Update failed';
		} finally {
			saving = false;
		}
	}

	function goBack() {
		selectedId = '';
		detail = null;
		edited = {};
		saveMessage = '';
	}

	function leadName(l: LeadSummary | LeadDetail) {
		return `${l.First_Name || ''} ${l.Last_Name || ''}`.trim() || '(no name)';
	}

	function statusBadge(status: string | null) {
		const s = (status || '').toLowerCase();
		if (s.includes('new lead')) return { bg: '#fef3c7', color: '#92400e' };
		if (s.includes('discovery')) return { bg: '#dbeafe', color: '#1e40af' };
		if (s.includes('site visit needed')) return { bg: '#ede9fe', color: '#5b21b6' };
		if (s.includes('booked - site')) return { bg: '#d1fae5', color: '#065f46' };
		return { bg: '#f3f4f6', color: '#6b7280' };
	}

	// Load on mount
	loadLeads();
</script>

<div class="container">
	{#if !selectedId}
		<!-- ── Lead List ──────────────────────────────────── -->
		<div class="page-header">
			<h1>Leads</h1>
			<a href="/admin" class="back-link">← Dashboard</a>
		</div>

		<input
			class="search"
			type="text"
			placeholder="Search by name, email, phone, or company…"
			bind:value={search}
		/>

		{#if listLoading}
			<p class="muted">Loading leads…</p>
		{:else if listError}
			<p class="error-text">{listError}</p>
		{:else if filtered.length === 0}
			<p class="muted">No leads found.</p>
		{:else}
			<div class="lead-list">
				{#each filtered as lead (lead.id)}
					{@const badge = statusBadge(lead.Lead_Status)}
					<button class="lead-row" on:click={() => selectLead(lead.id)}>
						<div class="lead-main">
							<span class="lead-name">{leadName(lead)}</span>
							{#if lead.Company}
								<span class="lead-company">{lead.Company}</span>
							{/if}
							{#if lead.Email || lead.Phone}
								<span class="lead-contact">
									{[lead.Email, lead.Phone].filter(Boolean).join(' · ')}
								</span>
							{/if}
						</div>
						<span class="badge" style="background:{badge.bg};color:{badge.color}">
							{lead.Lead_Status || '—'}
						</span>
					</button>
				{/each}
			</div>
			<p class="muted count">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>
		{/if}

	{:else}
		<!-- ── Lead Detail / Edit ─────────────────────────── -->
		<div class="page-header">
			<h1>
				{#if detail}{leadName(detail)}{:else}Loading…{/if}
			</h1>
			<button class="back-link" on:click={goBack}>← Back to list</button>
		</div>

		{#if detailLoading}
			<p class="muted">Loading lead details…</p>
		{:else if detailError}
			<p class="error-text">{detailError}</p>
		{:else if detail}
			<div class="detail-header">
				{@const badge = statusBadge(detail.Lead_Status)}
				<span class="badge" style="background:{badge.bg};color:{badge.color}">{detail.Lead_Status || '—'}</span>
				{#if detail.Email}<span class="meta">{detail.Email}</span>{/if}
				{#if detail.Phone}<span class="meta">{detail.Phone}</span>{/if}
			</div>

			<form class="edit-form" on:submit|preventDefault={save}>
				{#each FIELD_DEFS as field}
					<div class="field-group">
						<label for="field-{field.key}">{field.label}</label>

						{#if field.type === 'textarea'}
							<textarea
								id="field-{field.key}"
								rows="4"
								value={String(fieldValue(field.key) ?? '')}
								on:input={(e) => handleEdit(field.key, e.currentTarget.value)}
							></textarea>
						{:else if field.type === 'picklist'}
							<select
								id="field-{field.key}"
								value={String(fieldValue(field.key) ?? '')}
								on:change={(e) => handleEdit(field.key, e.currentTarget.value)}
							>
								{#each field.options ?? [] as opt}
									<option value={opt}>{opt === '-None-' ? '— Select —' : opt}</option>
								{/each}
							</select>
						{:else if field.type === 'boolean'}
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={Boolean(fieldValue(field.key))}
									on:change={(e) => handleEdit(field.key, e.currentTarget.checked)}
								/>
								<span>{fieldValue(field.key) ? 'Yes' : 'No'}</span>
							</label>
						{:else if field.type === 'readonly'}
							{@const val = fieldValue(field.key)}
							{#if val && typeof val === 'string'}
								<p class="readonly-value">{val}</p>
							{:else if val && typeof val === 'object'}
								<p class="readonly-value">(file attached)</p>
							{:else}
								<p class="readonly-value muted">None</p>
							{/if}
						{:else}
							<input
								id="field-{field.key}"
								type="text"
								value={String(fieldValue(field.key) ?? '')}
								on:input={(e) => handleEdit(field.key, e.currentTarget.value)}
							/>
						{/if}
					</div>
				{/each}

				<div class="save-bar">
					<button type="submit" class="save-btn" disabled={!hasChanges || saving}>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
					{#if saveMessage}
						<p class="save-msg" class:ok={saveOk} class:err={!saveOk}>{saveMessage}</p>
					{/if}
				</div>
			</form>
		{/if}
	{/if}
</div>

<style>
	.container {
		max-width: 860px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: #111827;
	}

	.back-link {
		font-size: 0.85rem;
		color: #6b7280;
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	.back-link:hover { color: #0066cc; }

	/* ── Search ────────────────────────────────────── */
	.search {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9rem;
		margin-bottom: 1rem;
		min-height: 44px;
	}
	.search:focus {
		outline: none;
		border-color: #0066cc;
		box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.15);
	}

	/* ── Lead list ─────────────────────────────────── */
	.lead-list {
		display: flex;
		flex-direction: column;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		overflow: hidden;
	}

	.lead-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid #f3f4f6;
		background: none;
		border-left: none;
		border-right: none;
		border-top: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		font: inherit;
	}
	.lead-row:last-child { border-bottom: none; }
	.lead-row:hover { background: #f9fafb; }

	.lead-main {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.lead-name {
		font-weight: 600;
		font-size: 0.95rem;
		color: #111827;
	}

	.lead-company {
		font-size: 0.82rem;
		color: #6b7280;
	}

	.lead-contact {
		font-size: 0.8rem;
		color: #9ca3af;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.count {
		text-align: center;
		margin-top: 0.75rem;
	}

	/* ── Detail header ────────────────────────────── */
	.detail-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.meta {
		font-size: 0.85rem;
		color: #6b7280;
	}

	/* ── Edit form ─────────────────────────────────── */
	.edit-form {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
		padding: 1.5rem;
	}

	.field-group {
		margin-bottom: 1.25rem;
	}
	.field-group:last-of-type {
		margin-bottom: 0;
	}

	.field-group label {
		display: block;
		font-weight: 600;
		font-size: 0.85rem;
		color: #374151;
		margin-bottom: 0.35rem;
	}

	.field-group input[type="text"],
	.field-group select,
	.field-group textarea {
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
		min-height: 40px;
		background: #fff;
	}

	.field-group input:focus,
	.field-group select:focus,
	.field-group textarea:focus {
		outline: none;
		border-color: #0066cc;
		box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.15);
	}

	.field-group textarea {
		resize: vertical;
	}

	.toggle-label {
		display: inline-flex !important;
		align-items: center;
		gap: 0.5rem;
		font-weight: 400 !important;
		cursor: pointer;
	}

	.toggle-label input[type="checkbox"] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.readonly-value {
		font-size: 0.9rem;
		color: #374151;
		margin: 0;
		padding: 0.5rem 0;
	}

	/* ── Save bar ──────────────────────────────────── */
	.save-bar {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid #f3f4f6;
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.save-btn {
		padding: 0.7rem 2rem;
		border: none;
		border-radius: 6px;
		background: #0066cc;
		color: white;
		font-weight: 600;
		cursor: pointer;
		min-height: 44px;
		font-size: 0.9rem;
	}

	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.save-msg {
		margin: 0;
		font-size: 0.85rem;
	}
	.save-msg.ok { color: #065f46; }
	.save-msg.err { color: #b91c1c; }

	/* ── Misc ──────────────────────────────────────── */
	.muted { color: #9ca3af; font-size: 0.85rem; }
	.error-text { color: #b91c1c; font-size: 0.85rem; }

	@media (max-width: 640px) {
		.container { padding: 1rem; }
		.lead-row { flex-direction: column; align-items: flex-start; gap: 0.4rem; }
		.edit-form { padding: 1.25rem; }
	}
</style>
