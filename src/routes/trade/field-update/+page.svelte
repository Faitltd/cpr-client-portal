<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import { createDraft, type DraftHandle } from '$lib/stores/draftStore';

	// --- Report type definitions ---
	type ReportType = 'field_update' | 'daily_log' | 'report_problem';

	const REPORT_TYPES: { value: ReportType; label: string }[] = [
		{ value: 'field_update', label: 'Field Update' },
		{ value: 'daily_log', label: 'Daily Log' },
		{ value: 'report_problem', label: 'Report a Problem' }
	];

	// --- Field Update types ---
	const UPDATE_TYPES = [
		{ value: 'progress', label: 'Progress Update' },
		{ value: 'issue', label: 'Issue' },
		{ value: 'material_delivery', label: 'Material Delivery' },
		{ value: 'inspection', label: 'Inspection' },
		{ value: 'weather_delay', label: 'Weather Delay' },
		{ value: 'schedule_change', label: 'Schedule Change' },
		{ value: 'completed_work', label: 'Completed Work' },
		{ value: 'other', label: 'Other' }
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
	let reportType: ReportType = 'field_update';

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

	// --- Field Update fields ---
	let fuUpdateType = 'progress';
	let fuNote = '';

	// --- Daily Log fields ---
	const today = new Date().toISOString().split('T')[0];
	let dlLogDate = today;
	let dlHoursWorked: number | '' = '';
	let dlWorkCompleted = '';
	let dlWorkPlanned = '';
	let dlIssuesEncountered = '';
	let dlWeatherDelay = false;

	// --- Report Problem fields ---
	let rpIssueType: string = 'damaged_material';
	let rpSeverity: string = 'medium';
	let rpTitle = '';
	let rpDescription = '';

	// --- Shared state ---
	let photoUploadRef: PhotoUpload;
	let submitting = false;
	let successMessage = '';
	let errorMessage = '';

	// --- Draft saving ---
	type UnifiedDraft = {
		reportType: ReportType;
		fuUpdateType: string;
		fuNote: string;
		dlLogDate: string;
		dlHoursWorked: number | '';
		dlWorkCompleted: string;
		dlWorkPlanned: string;
		dlIssuesEncountered: string;
		dlWeatherDelay: boolean;
		rpIssueType: string;
		rpSeverity: string;
		rpTitle: string;
		rpDescription: string;
	};

	let draft: DraftHandle<UnifiedDraft> | null = null;
	let draftStatus: 'idle' | 'saving' | 'saved' = 'idle';
	let draftRestorable = false;
	let draftSavedAt = 0;

	const getDraftData = (): UnifiedDraft => ({
		reportType, fuUpdateType, fuNote,
		dlLogDate, dlHoursWorked, dlWorkCompleted, dlWorkPlanned, dlIssuesEncountered, dlWeatherDelay,
		rpIssueType, rpSeverity, rpTitle, rpDescription
	});

	const isDraftEmpty = (d: UnifiedDraft) => {
		const fuEmpty = !d.fuNote.trim() && d.fuUpdateType === 'progress';
		const dlEmpty = !d.dlWorkCompleted.trim() && !d.dlWorkPlanned.trim() && !d.dlIssuesEncountered.trim()
			&& d.dlHoursWorked === '' && !d.dlWeatherDelay && d.dlLogDate === today;
		const rpEmpty = !d.rpTitle.trim() && !d.rpDescription.trim()
			&& d.rpIssueType === 'damaged_material' && d.rpSeverity === 'medium';
		return fuEmpty && dlEmpty && rpEmpty && d.reportType === 'field_update';
	};

	const restoreDraft = (d: UnifiedDraft) => {
		reportType = d.reportType;
		fuUpdateType = d.fuUpdateType;
		fuNote = d.fuNote;
		dlLogDate = d.dlLogDate;
		dlHoursWorked = d.dlHoursWorked;
		dlWorkCompleted = d.dlWorkCompleted;
		dlWorkPlanned = d.dlWorkPlanned;
		dlIssuesEncountered = d.dlIssuesEncountered;
		dlWeatherDelay = d.dlWeatherDelay;
		rpIssueType = d.rpIssueType;
		rpSeverity = d.rpSeverity;
		rpTitle = d.rpTitle;
		rpDescription = d.rpDescription;
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
		fuUpdateType = 'progress';
		fuNote = '';
		dlLogDate = today;
		dlHoursWorked = '';
		dlWorkCompleted = '';
		dlWorkPlanned = '';
		dlIssuesEncountered = '';
		dlWeatherDelay = false;
		rpIssueType = 'damaged_material';
		rpSeverity = 'medium';
		rpTitle = '';
		rpDescription = '';
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

			if (reportType === 'field_update') {
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: fuUpdateType,
						note: fuNote.trim() || null,
						photo_ids: photoIds.length > 0 ? photoIds : null
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
				}
				successMessage = 'Field update submitted successfully!';
			} else if (reportType === 'daily_log') {
				const res = await fetch('/api/trade/daily-log', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						dealId: selectedDealId,
						logDate: dlLogDate,
						hoursWorked: dlHoursWorked === '' ? undefined : dlHoursWorked,
						workCompleted: dlWorkCompleted,
						workPlanned: dlWorkPlanned,
						issuesEncountered: dlIssuesEncountered,
						weatherDelay: dlWeatherDelay,
						photoIds: photoIds.length > 0 ? photoIds : undefined
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
				}
				successMessage = 'Daily log submitted successfully!';
			} else if (reportType === 'report_problem') {
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

	$: submitLabel = reportType === 'field_update'
		? 'Submit Update'
		: reportType === 'daily_log'
			? 'Submit Daily Log'
			: 'Submit Issue';

	$: canSubmit = (() => {
		if (!selectedDealId) return false;
		if (reportType === 'report_problem' && !rpTitle.trim()) return false;
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
				<label for="report-type">Report Type</label>
				<select id="report-type" bind:value={reportType}>
					{#each REPORT_TYPES as rt}
						<option value={rt.value}>{rt.label}</option>
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
				{#if reportType === 'field_update'}
					<div class="form-field">
						<label for="update-type">Update Type</label>
						<select id="update-type" bind:value={fuUpdateType}>
							{#each UPDATE_TYPES as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>

					<div class="form-field">
						<label for="update-note">Note</label>
						<textarea
							id="update-note"
							bind:value={fuNote}
							rows="4"
							placeholder="Describe the update..."
						></textarea>
					</div>
				{:else if reportType === 'daily_log'}
					<div class="form-field">
						<label for="log-date">Date</label>
						<input id="log-date" type="date" bind:value={dlLogDate} required />
					</div>

					<div class="form-field">
						<label for="hours-worked">Hours Worked</label>
						<input
							id="hours-worked"
							type="number"
							step="0.5"
							min="0"
							max="24"
							bind:value={dlHoursWorked}
							placeholder="e.g. 8"
						/>
					</div>

					<div class="form-field">
						<label for="work-completed">Work Completed</label>
						<textarea
							id="work-completed"
							bind:value={dlWorkCompleted}
							placeholder="What did you accomplish today?"
						></textarea>
					</div>

					<div class="form-field">
						<label for="work-planned">Work Planned</label>
						<textarea
							id="work-planned"
							bind:value={dlWorkPlanned}
							placeholder="What's planned for tomorrow?"
						></textarea>
					</div>

					<div class="form-field">
						<label for="issues-encountered">Issues / Blockers</label>
						<textarea
							id="issues-encountered"
							bind:value={dlIssuesEncountered}
							placeholder="Any issues or blockers? (optional)"
						></textarea>
					</div>

					<div class="form-field form-field-checkbox">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={dlWeatherDelay} />
							Weather delayed work today
						</label>
					</div>
				{:else if reportType === 'report_problem'}
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
	input[type='date'],
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

	.form-field-checkbox {
		gap: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		color: #111827;
		cursor: pointer;
		min-height: 44px;
	}

	.checkbox-label input[type='checkbox'] {
		width: 1.1rem;
		height: 1.1rem;
		cursor: pointer;
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
