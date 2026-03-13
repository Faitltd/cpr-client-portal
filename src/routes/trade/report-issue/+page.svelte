<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';

	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	interface FieldIssue {
		id: string;
		deal_id: string;
		trade_partner_id: string | null;
		issue_type:
			| 'damaged_material'
			| 'field_conflict'
			| 'missing_info'
			| 'access_issue'
			| 'design_conflict'
			| 'unexpected_condition'
			| 'safety';
		severity: 'low' | 'medium' | 'high' | 'critical';
		title: string;
		description: string | null;
		photo_ids: string[] | null;
		photo_urls: string[] | null;
		status: 'open' | 'acknowledged' | 'resolved';
		resolved_at: string | null;
		created_at: string;
	}

	const deals = Array.isArray(data?.deals) ? data.deals : [];
	const tradePartnerName = data?.tradePartner?.name || data?.tradePartner?.email || 'Trade Partner';
	const issueTypeOptions = [
		{ value: 'damaged_material', label: 'Damaged Material' },
		{ value: 'field_conflict', label: 'Field Conflict' },
		{ value: 'missing_info', label: 'Missing Info' },
		{ value: 'access_issue', label: 'Access Issue' },
		{ value: 'design_conflict', label: 'Design Conflict' },
		{ value: 'unexpected_condition', label: 'Unexpected Condition' },
		{ value: 'safety', label: 'Safety' }
	] as const;
	const severityOptions = [
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'critical', label: 'Critical' }
	] as const;

	let selectedDealId = deals[0]?.id || '';
	let issueType: FieldIssue['issue_type'] = 'damaged_material';
	let severity: FieldIssue['severity'] = 'medium';
	let title = '';
	let description = '';
	let uploadedPhotoIds: string[] = [];
	let photoUploadRef: PhotoUpload;
	let submitting = false;
	let successMessage = '';
	let errorMessage = '';

	let issues: FieldIssue[] = [];
	let issuesLoading = false;
	let issuesError = '';
	let lastIssuesDealId = '';
	let issuesController: AbortController | null = null;

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

	const getIssueTypeLabel = (value: FieldIssue['issue_type']) => {
		const option = issueTypeOptions.find((item) => item.value === value);
		return option?.label || value;
	};

	const formatTimestamp = (value: string) => {
		const date = new Date(value);
		if (Number.isNaN(date.valueOf())) return value;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	const loadIssues = async (dealId: string) => {
		if (!dealId) return;

		issuesController?.abort();
		issuesController = new AbortController();
		issuesLoading = true;
		issuesError = '';
		successMessage = '';

		try {
			const res = await fetch(`/api/trade/field-issues?dealId=${encodeURIComponent(dealId)}`, {
				signal: issuesController.signal
			});
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.error || payload?.message || `Failed to fetch issues (${res.status})`);
			}
			const payload = await res.json().catch(() => ({}));
			issues = Array.isArray(payload?.data) ? payload.data : [];
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			issuesError = err instanceof Error ? err.message : 'Failed to fetch issues.';
			issues = [];
		} finally {
			issuesLoading = false;
		}
	};

	const handleSubmit = async () => {
		if (!selectedDealId || !issueType || !title.trim()) {
			errorMessage = 'Please complete the required fields before submitting.';
			return;
		}

		submitting = true;
		successMessage = '';
		errorMessage = '';

		try {
			const photoIds = photoUploadRef?.getPhotoIds() ?? [];
			const res = await fetch('/api/trade/field-issues', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deal_id: selectedDealId,
					issue_type: issueType,
					severity,
					title: title.trim(),
					description: description.trim() || undefined,
					photo_ids: photoIds.length > 0 ? photoIds : undefined
				})
			});

			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
			}

			const payload = await res.json().catch(() => ({}));
			const created = payload?.data as FieldIssue | undefined;
			if (!created) {
				throw new Error('Issue was created but no response data was returned.');
			}

			title = '';
			description = '';
			issueType = 'damaged_material';
			severity = 'medium';
			photoUploadRef?.reset();
			uploadedPhotoIds = [];
			successMessage = 'Issue submitted successfully.';
			issues = [created, ...issues];
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to submit issue.';
		} finally {
			submitting = false;
		}
	};

	$: canSubmit = Boolean(selectedDealId && issueType && title.trim());

	$: if (browser && selectedDealId && selectedDealId !== lastIssuesDealId) {
		lastIssuesDealId = selectedDealId;
		loadIssues(selectedDealId);
	}

	onDestroy(() => issuesController?.abort());
</script>

<div class="dashboard">
	<header>
		<a class="back-link" href="/trade/dashboard">&lt; Back to Dashboard</a>
		<h1>Report Field Issue</h1>
		<p class="subtitle">Reporting as {tradePartnerName}</p>
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
			<h2>New Issue</h2>

			{#if successMessage}
				<div class="success-message">{successMessage}</div>
			{/if}
			{#if errorMessage}
				<div class="error-message">{errorMessage}</div>
			{/if}

			<form on:submit|preventDefault={handleSubmit}>
				<div class="form-field">
					<label for="issue-type">Issue Type</label>
					<select id="issue-type" bind:value={issueType}>
						{#each issueTypeOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>

				<fieldset class="form-field severity-fieldset">
					<legend>Severity</legend>
					<div class="severity-grid">
						{#each severityOptions as option}
							<label class="severity-option" class:is-selected={severity === option.value}>
								<input type="radio" bind:group={severity} value={option.value} />
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
						bind:value={title}
						placeholder="Short summary of the issue"
						required
					/>
				</div>

				<div class="form-field">
					<label for="issue-description">Description</label>
					<textarea
						id="issue-description"
						rows="4"
						bind:value={description}
						placeholder="Add details that will help the office team review the issue"
					></textarea>
				</div>

				<div class="form-field">
					<label>Photos</label>
					<PhotoUpload
						bind:this={photoUploadRef}
						on:change={(e) => { uploadedPhotoIds = e.detail.map((p) => p.id); }}
					/>
				</div>

				<button class="submit-button" type="submit" disabled={submitting || !canSubmit}>
					{submitting ? 'Submitting...' : 'Submit Issue'}
				</button>
			</form>
		</div>

		<div class="card issues-card">
			<h2>My Reported Issues</h2>

			{#if issuesLoading}
				<p class="muted">Loading issues...</p>
			{:else if issuesError}
				<p class="error-text">{issuesError}</p>
			{:else if issues.length === 0}
				<p class="muted">No reported issues for this deal yet.</p>
			{:else}
				<div class="issues-list">
					{#each issues as issue (issue.id)}
						<article class="card issue-card">
							<div class="issue-header">
								<div class="issue-heading">
									<span class="badge severity-badge severity-{issue.severity}">{issue.severity}</span>
									<h3>{issue.title}</h3>
								</div>
								<div class="issue-meta">
									<span class="badge issue-type-badge">{getIssueTypeLabel(issue.issue_type)}</span>
									<span class="badge status-badge status-{issue.status}">{issue.status}</span>
									<span class="issue-time">{formatTimestamp(issue.created_at)}</span>
								</div>
							</div>

							{#if issue.description}
								<p class="issue-description">{issue.description}</p>
							{/if}

							{#if issue.photo_urls?.length}
								<div class="issue-photos">
									{#each issue.photo_urls as url}
										<a href={url} target="_blank" rel="noopener noreferrer" class="issue-photo-thumb">
											<img src={url} alt="Issue photo" loading="lazy" />
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

	.form-card h2,
	.issues-card h2 {
		margin-top: 0;
		margin-bottom: 1.25rem;
	}

	.success-message {
		color: #065f46;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.25rem;
	}

	.error-message {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.25rem;
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

	select,
	input[type='text'],
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
		line-height: 1.5;
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
		width: 100%;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 999px;
		min-height: 44px;
		font-weight: 700;
		font-size: 1rem;
		padding: 0.85rem 1.25rem;
		cursor: pointer;
	}

	.submit-button:hover:not(:disabled) {
		background: #0052a3;
	}

	.submit-button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.muted {
		margin: 0;
		color: #6b7280;
	}

	.error-text {
		margin: 0;
		color: #b91c1c;
	}

	.issues-list {
		display: grid;
		gap: 1rem;
	}

	.issue-card {
		margin-bottom: 0;
	}

	.issue-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.9rem;
	}

	.issue-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
	}

	.issue-heading h3 {
		margin: 0;
		font-size: 1.05rem;
		color: #111827;
	}

	.issue-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.55rem;
	}

	.issue-description {
		margin: 1rem 0 0;
		color: #374151;
		line-height: 1.55;
	}

	.issue-photos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.issue-photo-thumb {
		display: block;
		width: 64px;
		height: 64px;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #e5e7eb;
	}

	.issue-photo-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.issue-time {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: capitalize;
	}

	.severity-critical {
		background: #dc2626;
		color: #fff;
	}

	.severity-high {
		background: #f59e0b;
		color: #111827;
	}

	.severity-medium {
		background: #e5e7eb;
		color: #111827;
	}

	.severity-low {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.issue-type-badge {
		background: #f3f4f6;
		color: #374151;
	}

	.status-open {
		background: #fef3c7;
		color: #92400e;
	}

	.status-acknowledged {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.status-resolved {
		background: #d1fae5;
		color: #065f46;
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

		.issue-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
