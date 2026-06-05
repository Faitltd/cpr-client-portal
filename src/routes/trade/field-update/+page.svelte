<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
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

	// --- Data from server ---
	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const deals = Array.isArray(data?.deals) ? data.deals : [];
	const tradePartnerName = data?.tradePartner?.name || data?.tradePartner?.email || 'Trade Partner';

	// Pre-select the deal from `?deal=<id>` URL param (set when arriving from
	// the dashboard) if it's in the partner's deal list. Falls back to the
	// first deal otherwise.
	function pickInitialDealId(): string {
		if (browser) {
			const urlDealId = new URL(window.location.href).searchParams.get('deal');
			if (urlDealId && deals.some((d) => String(d.id) === urlDealId)) return urlDealId;
		}
		return deals[0]?.id ? String(deals[0].id) : '';
	}

	let selectedDealId = pickInitialDealId();
	let submissionType: SubmissionType = 'field_update';

	// When rendered inside an <iframe> on the trade dashboard, hide the page
	// chrome (back link, header, deal selector) and let the parent tab supply
	// the project context. Driven by ?embed=1 in the URL.
	const embedMode = browser ? new URL(window.location.href).searchParams.get('embed') === '1' : false;

	// Re-evaluate after mount in case the URL is only available client-side.
	onMount(() => {
		if (!selectedDealId || selectedDealId === String(deals[0]?.id || '')) {
			const fromUrl = new URL(window.location.href).searchParams.get('deal');
			if (fromUrl && deals.some((d) => String(d.id) === fromUrl)) {
				selectedDealId = fromUrl;
			}
		}
	});

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
	let rpNote = '';

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
		rpNote: string;
		coScope: string;
		coCost: number | '';
	};

	let draft: DraftHandle<UnifiedDraft> | null = null;
	let draftStatus: 'idle' | 'saving' | 'saved' = 'idle';
	let draftRestorable = false;
	let draftSavedAt = 0;

	const getDraftData = (): UnifiedDraft => ({
		submissionType, fuNote, rpNote, coScope, coCost
	});

	const isDraftEmpty = (d: UnifiedDraft) => {
		const fuEmpty = !d.fuNote.trim();
		const rpEmpty = !d.rpNote.trim();
		const coEmpty = !d.coScope.trim() && d.coCost === '';
		return fuEmpty && rpEmpty && coEmpty && d.submissionType === 'field_update';
	};

	const restoreDraft = (d: UnifiedDraft) => {
		submissionType = d.submissionType;
		fuNote = d.fuNote;
		rpNote = d.rpNote;
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
		rpNote = '';
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
			} else if (submissionType === 'materials') {
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: 'material_delivery',
						note: fuNote.trim() || null,
						photo_ids: photoIdsOrNull
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
				}
				successMessage = 'Materials update submitted successfully!';
			} else if (submissionType === 'schedule_change') {
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: 'schedule_change',
						note: fuNote.trim() || null,
						photo_ids: null
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
				}
				successMessage = 'Schedule change submitted successfully!';
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
				const res = await fetch('/api/trade/field-updates', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						deal_id: selectedDealId,
						update_type: 'issue',
						note: rpNote.trim() || null,
						photo_ids: photoIdsOrNull
					})
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload?.error || `Request failed (${res.status})`);
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

	// Svelte 5's legacy-mode `$:` only tracks identifiers it can see at the top
	// of the right-hand side. Wrapping the logic in an IIFE hides the deps and
	// the reactive statement only fires once. Compute as plain expressions so
	// every referenced var is visible to the dependency tracker.
	$: hasDeal = !!selectedDealId;
	$: rpNoteFilled = submissionType !== 'report_problem' || rpNote.trim().length > 0;
	$: coValid =
		submissionType !== 'change_order' ||
		(coScope.trim().length > 0 &&
			coCost !== '' &&
			Number.isFinite(coCost) &&
			(coCost as number) > 0);

	$: canSubmit = hasDeal && rpNoteFilled && coValid;

	$: disabledReason = !hasDeal
		? 'Select a project above to enable submission.'
		: !rpNoteFilled
			? 'Describe the problem to enable submission.'
			: submissionType === 'change_order' && !coScope.trim()
				? 'Describe the scope of the change to enable submission.'
				: submissionType === 'change_order' && !coValid
					? 'Enter an estimated cost greater than 0.'
					: '';

	onDestroy(() => {
		draft?.cancelPending();
	});
</script>

<div class="dashboard" class:embedded={embedMode}>
	{#if !embedMode}
		<header>
			<a class="back-link" href="/trade/dashboard">&larr; Back to Dashboard</a>
			<h1>Field Update</h1>
			<p class="subtitle">Submitting as {tradePartnerName}</p>
		</header>
	{/if}

	{#if data?.warning}
		<div class="card warning">{data.warning}</div>
	{:else if deals.length === 0}
		<div class="card">
			<p>No deals found for your account yet.</p>
		</div>
	{:else}
		{#if !embedMode}
			<div class="trade-selector card">
				<label for="trade-deal">Select Deal</label>
				<select id="trade-deal" bind:value={selectedDealId}>
					{#each deals as deal}
						<option value={deal.id}>{getDealLabel(deal)}</option>
					{/each}
				</select>
			</div>
		{/if}

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
						<label for="problem-note">Note</label>
						<textarea
							id="problem-note"
							bind:value={rpNote}
							rows="6"
							placeholder="Describe the problem..."
							required
						></textarea>
					</div>
				{/if}

				{#if submissionType !== 'schedule_change'}
					<div class="form-field">
						<!-- svelte-ignore a11y_label_has_associated_control -->
						<label>Photos</label>
						<PhotoUpload bind:this={photoUploadRef} maxFiles={20} />
					</div>
				{/if}

				<div class="form-footer">
					<button class="submit-button" type="submit" disabled={submitting || !canSubmit}>
						{submitting ? 'Submitting...' : submitLabel}
					</button>
					{#if draftStatus === 'saving'}
						<span class="draft-indicator">Saving&hellip;</span>
					{:else if draftStatus === 'saved'}
						<span class="draft-indicator">Draft saved</span>
					{/if}
					{#if !canSubmit && !submitting && disabledReason}
						<span class="disabled-hint">{disabledReason}</span>
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

	.disabled-hint {
		color: #b45309;
		background: #fef3c7;
		border: 1px solid #fde68a;
		font-size: 0.85rem;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1rem;
		}

		.card {
			padding: 1.1rem;
		}

		.submit-button {
			width: 100%;
		}
	}

	.dashboard.embedded {
		padding: 0;
		margin: 0;
		max-width: 100%;
		background: transparent;
	}
	.dashboard.embedded :global(header) {
		display: none;
	}
</style>
