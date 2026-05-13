<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import { createDraft, type DraftHandle } from '$lib/stores/draftStore';

	// --- Submission type definitions ---
	type SubmissionType =
		| 'field_update'
		| 'report_problem'
		| 'materials'
		| 'schedule_change'
		| 'change_order';

	const SUBMISSION_TYPES: { value: SubmissionType; label: string }[] = [
		{ value: 'field_update', label: 'Field Update' },
		{ value: 'report_problem', label: 'Report a Problem' },
		{ value: 'materials', label: 'Materials' },
		{ value: 'schedule_change', label: 'Schedule Change' },
		{ value: 'change_order', label: 'Change Order Request' }
	];

	// --- Report Issue types ---
	const ISSUE_TYPE_OPTIONS = [
		{ value: 'damaged_material', label: 'Damaged Material' },
		{ value: 'field_conflict', label: 'Field Conflict' },
		{ value: 'missing_info', label: 'Missing Info' },
		{ value: 'access_issue', label: 'Access Issue' },
		{ value: 'design_conflict', label: 'Design Conflict' },
		{ value: 'unexpected_condition', label: 'Unexpected Condition' },
		{ value: 'safety', label: 'Safety' }
	] as const;

	const SEVERITY_OPTIONS = [
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'critical', label: 'Critical' }
	] as const;

	// --- Data from server ---
	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const deals = Array.isArray(data?.deals) ? data.deals : [];
	const tradePartnerName = data?.tradePartner?.name || data?.tradePartner?.email || 'Trade Partner';
	let selectedDealId = deals[0]?.id || '';
	let submissionType: SubmissionType = 'field_update';

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

	// --- Field Update / Materials / Schedule Change shared note ---
	let fuNote = '';

	// --- Report Problem fields ---
	let rpIssueType: string = 'damaged_material';
	let rpSeverity: string = 'medium';
	let rpTitle = '';
	let rpDescription = '';

	// --- Change Order Request fields ---
	let coScope = '';
	let coCost: number | '' = '';

	// --- Shared state ---
	let photoUploadRef: PhotoUpload;
	let submitting = false;
	let successMessage = '';
	let errorMessage = '';

	// --- Draft saving ---
	type UnifiedDraft = {
		submissionType: SubmissionType;
		fuNote: string;
		rpIssueType: string;
		rpSeverity: string;
		rpTitle: string;
		rpDescription: string;
		coScope: string;
		coCost: number | '';
	};

	let draft: DraftHandle<UnifiedDraft> | null = null;
	let draftStatus: 'idle' | 'saving' | 'saved' = 'idle';
	let draftRestorable = false;
	let draftSavedAt = 0;

	const getDraftData = (): UnifiedDraft => ({
		submissionType, fuNote,
		rpIssueType, rpSeverity, rpTitle, rpDescription,
		coScope, coCost
	});

	const isDraftEmpty = (d: UnifiedDraft) => {
		const fuEmpty = !d.fuNote.trim();
		const rpEmpty = !d.rpTitle.trim() && !d.rpDescription.trim()
			&& d.rpIssueType === 'damaged_material' && d.rpSeverity === 'medium';
		const coEmpty = !d.coScope.trim() && d.coCost === '';
		return fuEmpty && rpEmpty && coEmpty && d.submissionType === 'field_update';
	};

	const restoreDraft = (d: UnifiedDraft) => {
		submissionType = d.submissionType;
		fuNote = d.fuNote;
		rpIssueType = d.rpIssueType;
		rpSeverity = d.rpSeverity;
		rpTitle = d.rpTitle;
		rpDescription = d.rpDescription;
		coScope = d.coScope;
		coCost = d.coCost;
		draftRestorable = false;
	};

	const dismissDraft = () => {
		draftRestorable = false;
		draft?.clear();
	};

	const initDraft = (dealId: string) => {
		draft?.cancelPending();
		draftStatus = 'idle';
		draftRestorable = false;
		draft = createDraft<UnifiedDraft>(`draft_unified_${dealId}`, isDraftEmpty);
		const saved = draft.load();
		if (saved) {
			draftRestorable = true;
			draftSavedAt = saved.savedAt;
		}
	};

	$: if (browser && selectedDealId) initDraft(selectedDealId);

	$: if (browser && draft && !draftRestorable) {
		const d = getDraftData();
		if (!isDraftEmpty(d)) {
			draftStatus = 'saving';
			draft.scheduleSave(d);
			setTimeout(() => { draftStatus = 'saved'; }, 2100);
		} else {
			draft.clear();
			draftStatus = 'idle';
		}
	}

	// --- Submission ---
	const resetForm = () => {
		fuNote = '';
		rpIssueType = 'damaged_material';
		rpSeverity = 'medium';
		rpTitle = '';
		rpDescription = '';
		coScope = '';
		coCost = '';
		photoUploadRef?.reset();
	};

	const handleSubmit = async () => {
		if (!selectedDealId) {
			errorMessage = 'Please select a deal first.';
			return;
		}

		submitting = true;
		successMessage = '';
		errorMessage = '';

		try {
			const photoIds = photoUploadRef?.getPhotoIds() ?? [];
			const photoIdsOrNull = photoIds.length > 0 ? photoIds : null;

			if (submissionType === 'field_update') {
				const fuRes = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: 'progress',
						note: fuNote.trim() || null,
						photo_ids: photoIdsOrNull
					})
				});
				if (!fuRes.ok) {
					const payload = await fuRes.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${fuRes.status})`);
				}
				successMessage = 'Field update submitted successfully!';
			} else if (submissionType === 'materials' || submissionType === 'schedule_change') {
				const updateType =
					submissionType === 'materials' ? 'material_delivery' : 'schedule_change';
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: updateType,
						note: fuNote.trim() || null,
						photo_ids: photoIdsOrNull
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
				}
				successMessage =
					submissionType === 'materials'
						? 'Materials update submitted successfully!'
						: 'Schedule change submitted successfully!';
			} else if (submissionType === 'change_order') {
				if (!coScope.trim()) {
					errorMessage = 'Please describe the scope of the change.';
					submitting = false;
					return;
				}
				if (coCost === '' || !Number.isFinite(coCost) || (coCost as number) <= 0) {
					errorMessage = 'Please enter an estimated cost greater than 0.';
					submitting = false;
					return;
				}
				const costFmt = (coCost as number).toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				});
				const note = `Scope: ${coScope.trim()}\n\nEstimated Cost: $${costFmt}`;
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: 'change_order',
						note,
						photo_ids: photoIdsOrNull
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
				}
				successMessage = 'Change order request submitted successfully!';
			} else if (submissionType === 'report_problem') {
				if (!rpTitle.trim()) {
					errorMessage = 'Please enter a title for the issue.';
					submitting = false;
					return;
				}
				const res = await fetch('/api/trade/field-issues', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						issue_type: rpIssueType,
						severity: rpSeverity,
						title: rpTitle.trim(),
						description: rpDescription.trim() || undefined,
						photo_ids: photoIds.length > 0 ? photoIds : undefined
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
				}
				successMessage = 'Issue reported successfully!';
			}

			draft?.clear();
			draftStatus = 'idle';
			resetForm();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to submit. Please try again.';
		} finally {
			submitting = false;
		}
	};

	const SUBMIT_LABELS: Record<SubmissionType, string> = {
		field_update: 'Submit Update',
		report_problem: 'Submit Issue',
		materials: 'Submit Materials Note',
		schedule_change: 'Submit Schedule Change',
		change_order: 'Submit Change Order'
	};

	$: submitLabel = SUBMIT_LABELS[submissionType];

	$: canSubmit = (() => {
		if (!selectedDealId) return false;
		if (submissionType === 'report_problem' && !rpTitle.trim()) return false;
		if (
			submissionType === 'change_order' &&
			(!coScope.trim() || coCost === '' || !Number.isFinite(coCost) || (coCost as number) <= 0)
		) {
			return false;
		}
		return true;
	})();

	onDestroy(() => {
		draft?.cancelPending();
	});
</script>

<div class="dashboard">
	<header>
		<a class="back-link" href="/trade/dashboard">&larr; Back to Dashboard</a>
		<h1>Field Update</h1>
		<p class="subtitle">Submitting as {tradePartnerName}</p>
	</header>

	{#if data?.warning}
		<div class="card warning">{data.warning}</div>
	{:else if deals.length === 0}
		<div class="card">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		<div class="trade-selector card">
			<label for="trade-deal">Select Deal</label>
			<select id="trade-deal" bind:value={selectedDealId}>
				{#each deals as deal}
					<option value={deal.id}>{getDealLabel(deal)}</option>
				{/each}
			</select>
		</div>

		<div class="card form-card">
			<div class="form-field">
				<label for="submission-type">Type</label>
				<select id="submission-type" bind:value={submissionType}>
					{#each SUBMISSION_TYPES as st}
						<option value={st.value}>{st.label}</option>
					{/each}
				</select>
			</div>

			{#if draftRestorable}
				<div class="draft-banner">
					<span>Draft saved {new Date(draftSavedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
					<div class="draft-banner-actions">
						<button type="button" class="draft-restore-btn" on:click={() => { const saved = draft?.load(); if (saved) restoreDraft(saved.data); }}>Restore</button>
						<button type="button" class="draft-dismiss-btn" on:click={dismissDraft}>Dismiss</button>
					</div>
				</div>
			{/if}

			{#if successMessage}
				<div class="success-message">{successMessage}</div>
			{/if}
			{#if errorMessage}
				<div class="error-message">{errorMessage}</div>
			{/if}

			<form on:submit|preventDefault={handleSubmit}>
				{#if submissionType === 'field_update'}
					<div class="form-field">
						<label for="update-note">Note</label>
						<textarea
							id="update-note"
							bind:value={fuNote}
							rows="6"
							placeholder="Describe the update..."
						></textarea>
					</div>
				{:else if submissionType === 'materials'}
					<div class="form-field">
						<label for="materials-note">Note</label>
						<textarea
							id="materials-note"
							bind:value={fuNote}
							rows="4"
							placeholder="Materials delivered, expected, or short — describe here..."
						></textarea>
					</div>
				{:else if submissionType === 'schedule_change'}
					<div class="form-field">
						<label for="schedule-note">Note</label>
						<textarea
							id="schedule-note"
							bind:value={fuNote}
							rows="4"
							placeholder="Describe the schedule change (new dates, reason, impact)..."
						></textarea>
					</div>
				{:else if submissionType === 'change_order'}
					<div class="form-field">
						<label for="co-scope">Scope</label>
						<textarea
							id="co-scope"
							bind:value={coScope}
							rows="4"
							placeholder="Describe the scope of the change..."
							required
						></textarea>
					</div>

					<div class="form-field">
						<label for="co-cost">Estimated Cost ($)</label>
						<input
							id="co-cost"
							type="number"
							step="0.01"
							min="0"
							bind:value={coCost}
							placeholder="e.g. 450.00"
							required
						/>
					</div>
				{:else if submissionType === 'report_problem'}
					<div class="form-field">
						<label for="issue-type">Issue Type</label>
						<select id="issue-type" bind:value={rpIssueType}>
							{#each ISSUE_TYPE_OPTIONS as option}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>

					<fieldset class="form-field severity-fieldset">
						<legend>Severity</legend>
						<div class="severity-grid">
							{#each SEVERITY_OPTIONS as option}
								<label class="severity-option" class:is-selected={rpSeverity === option.value}>
									<input type="radio" bind:group={rpSeverity} value={option.value} />
									<span>{option.label}</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<div class="form-field">
						<label for="issue-title">Title</label>
						<input
							id="issue-title"
							type="text"
							bind:value={rpTitle}
							placeholder="Short summary of the issue"
							required
						/>
					</div>

					<div class="form-field">
						<label for="issue-description">Description</label>
						<textarea
							id="issue-description"
							rows="4"
							bind:value={rpDescription}
							placeholder="Add details that will help the office team review the issue"
						></textarea>
					</div>
				{/if}

				<div class="form-field">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label>Photos</label>
					<PhotoUpload bind:this={photoUploadRef} maxFiles={5} />
				</div>

				<div class="form-footer">
					<button class="submit-button" type="submit" disabled={submitting || !canSubmit}>
						{submitting ? 'Submitting...' : submitLabel}
					</button>
					{#if draftStatus === 'saving'}
						<span class="draft-indicator">Saving&hellip;</span>
					{:else if draftStatus === 'saved'}
						<span class="draft-indicator">Draft saved</span>
					{/if}
				</div>
			</form>
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		color: #0066cc;
		text-decoration: none;
		font-size: 0.95rem;
		margin-bottom: 0.75rem;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		margin: 0 0 0.35rem;
		color: #111827;
		font-size: 1.9rem;
	}

	.subtitle {
		margin: 0;
		color: #4b5563;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
		margin-bottom: 1.5rem;
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

	.form-card {
		display: grid;
		gap: 1.1rem;
	}

	.success-message {
		color: #065f46;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		border-radius: 8px;
		padding: 1rem;
	}

	.error-message {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 1rem;
	}

	form {
		display: grid;
		gap: 1.1rem;
	}

	.form-field {
		display: grid;
		gap: 0.4rem;
	}

	.form-field label {
		font-weight: 600;
		font-size: 0.95rem;
		color: #111827;
	}

	select,
	input[type='text'],
	input[type='number'],
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		min-height: 44px;
		font-size: 1rem;
		font-family: inherit;
		background: #fff;
	}

	textarea {
		resize: vertical;
		min-height: 100px;
		line-height: 1.5;
	}

	.severity-fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}

	.severity-fieldset legend {
		padding: 0;
		margin-bottom: 0.4rem;
		font-weight: 600;
		font-size: 0.95rem;
		color: #111827;
	}

	.severity-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.severity-option {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.85rem 1rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: #f9fafb;
		cursor: pointer;
		min-height: 44px;
		box-sizing: border-box;
	}

	.severity-option input[type='radio'] {
		margin: 0;
		flex-shrink: 0;
	}

	.severity-option span {
		font-weight: 600;
		color: #111827;
	}

	.severity-option.is-selected {
		border-color: #0066cc;
		background: #eff6ff;
	}

	.submit-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		font-weight: 700;
		border-radius: 10px;
		padding: 0.85rem 1.25rem;
		min-height: 44px;
		font-size: 1rem;
		cursor: pointer;
		width: fit-content;
	}

	.submit-button:hover:not(:disabled) {
		background: #0052a3;
	}

	.submit-button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.draft-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.85rem 1rem;
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 8px;
		color: #1e40af;
		font-size: 0.9rem;
	}

	.draft-banner-actions {
		display: flex;
		gap: 0.5rem;
	}

	.draft-restore-btn {
		background: #2563eb;
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 0.4rem 0.85rem;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.draft-restore-btn:hover {
		background: #1d4ed8;
	}

	.draft-dismiss-btn {
		background: transparent;
		color: #1e40af;
		border: 1px solid #93c5fd;
		border-radius: 6px;
		padding: 0.4rem 0.85rem;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.draft-dismiss-btn:hover {
		background: #dbeafe;
	}

	.form-footer {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.draft-indicator {
		color: #9ca3af;
		font-size: 0.85rem;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1rem;
		}

		.card {
			padding: 1.1rem;
		}

		.severity-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.submit-button {
			width: 100%;
		}
	}
</style>
