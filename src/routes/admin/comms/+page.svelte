<script lang="ts">
	import { onMount } from 'svelte';
	import { selectedDealId } from '$lib/stores/dealContext';

	interface CommsLogEntry {
		id: string;
		deal_id: string;
		channel: 'email' | 'phone' | 'text' | 'portal' | 'in_person';
		direction: 'inbound' | 'outbound';
		subject: string | null;
		summary: string | null;
		contacted_by: string | null;
		sla_target_hours: number;
		created_at: string;
	}

	// Deal loader
	let dealIdInput = '';
	let loadedDealId = '';

	// Timeline data
	let entries: CommsLogEntry[] = [];
	let loading = false;
	let loadError = '';

	// Log form
	let formChannel: CommsLogEntry['channel'] = 'email';
	let formDirection: CommsLogEntry['direction'] = 'outbound';
	let formSubject = '';
	let formSummary = '';
	let formContactedBy = '';
	let formSlaHours = 48;
	let submitting = false;
	let submitError = '';
	let submitSuccess = false;

	onMount(() => {
		const stored = $selectedDealId;
		if (stored) {
			dealIdInput = stored;
			loadedDealId = stored;
			fetchEntries();
		}
	});

	async function loadDeal() {
		const id = dealIdInput.trim();
		if (!id) return;
		loadedDealId = id;
		selectedDealId.set(id);
		submitSuccess = false;
		await fetchEntries();
	}

	async function fetchEntries() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/admin/comms?dealId=${encodeURIComponent(loadedDealId)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to load');
			entries = json.data ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load communications';
		} finally {
			loading = false;
		}
	}

	async function submitLog() {
		submitting = true;
		submitError = '';
		submitSuccess = false;
		try {
			const res = await fetch('/api/admin/comms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dealId: loadedDealId,
					channel: formChannel,
					direction: formDirection,
					subject: formSubject.trim() || undefined,
					summary: formSummary.trim() || undefined,
					contactedBy: formContactedBy.trim() || undefined,
					slaTargetHours: formSlaHours
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || 'Failed to log');
			formSubject = '';
			formSummary = '';
			formContactedBy = '';
			formChannel = 'email';
			formDirection = 'outbound';
			formSlaHours = 48;
			submitSuccess = true;
			await fetchEntries();
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Failed to log communication';
		} finally {
			submitting = false;
		}
	}

	const channelEmoji: Record<string, string> = {
		email: '📧',
		phone: '📞',
		text: '💬',
		portal: '🌐',
		in_person: '🤝'
	};

	const channelLabel: Record<string, string> = {
		email: 'Email',
		phone: 'Phone',
		text: 'Text',
		portal: 'Portal',
		in_person: 'In Person'
	};

	function isOverdue(entry: CommsLogEntry): boolean {
		if (!entry.sla_target_hours) return false;
		const deadline = new Date(entry.created_at).getTime() + entry.sla_target_hours * 60 * 60 * 1000;
		return Date.now() > deadline;
	}

	function fmtDateTime(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
	}
</script>

<div class="container">
	<h1>Communications Log</h1>

	<!-- Deal ID loader -->
	<div class="card loader-card">
		<label class="field-label" for="deal-id-input">Deal ID</label>
		<div class="loader-row">
			<input
				id="deal-id-input"
				class="input"
				type="text"
				placeholder="Enter Zoho Deal ID"
				bind:value={dealIdInput}
				on:keydown={(e) => e.key === 'Enter' && loadDeal()}
			/>
			<button class="btn btn-primary" on:click={loadDeal} disabled={!dealIdInput.trim()}>
				Load
			</button>
		</div>
		{#if loadedDealId}
			<p class="muted" style="margin: 0.5rem 0 0;">
				Showing: <strong>{loadedDealId}</strong>
			</p>
		{/if}
	</div>

	{#if loadedDealId}
		<!-- Log new communication -->
		<section class="section">
			<h2>Log Communication</h2>
			<div class="card">
				<form on:submit|preventDefault={submitLog}>
					<div class="field-row">
						<div class="field">
							<label class="field-label" for="form-channel">Channel <span class="required">*</span></label>
							<select id="form-channel" class="select" bind:value={formChannel}>
								<option value="email">📧 Email</option>
								<option value="phone">📞 Phone</option>
								<option value="text">💬 Text</option>
								<option value="portal">🌐 Portal</option>
								<option value="in_person">🤝 In Person</option>
							</select>
						</div>

						<div class="field">
							<label class="field-label" for="form-direction">Direction</label>
							<select id="form-direction" class="select" bind:value={formDirection}>
								<option value="outbound">Outbound</option>
								<option value="inbound">Inbound</option>
							</select>
						</div>

						<div class="field">
							<label class="field-label" for="form-contacted-by">Contacted By</label>
							<input
								id="form-contacted-by"
								class="input"
								type="text"
								placeholder="e.g. Sarah"
								bind:value={formContactedBy}
							/>
						</div>

						<div class="field field-sla">
							<label class="field-label" for="form-sla">SLA Hours</label>
							<input
								id="form-sla"
								class="input"
								type="number"
								min="1"
								bind:value={formSlaHours}
							/>
						</div>
					</div>

					<div class="field">
						<label class="field-label" for="form-subject">Subject</label>
						<input
							id="form-subject"
							class="input input-full"
							type="text"
							placeholder="Brief subject line"
							bind:value={formSubject}
						/>
					</div>

					<div class="field">
						<label class="field-label" for="form-summary">Summary</label>
						<textarea
							id="form-summary"
							class="textarea"
							rows="3"
							placeholder="What was communicated?"
							bind:value={formSummary}
						></textarea>
					</div>

					{#if submitError}
						<p class="error-text">{submitError}</p>
					{/if}
					{#if submitSuccess}
						<p class="success-text">Communication logged.</p>
					{/if}

					<div class="form-footer">
						<button class="btn btn-primary" type="submit" disabled={submitting}>
							{submitting ? 'Logging…' : 'Log Communication'}
						</button>
					</div>
				</form>
			</div>
		</section>

		<!-- Timeline -->
		<section class="section">
			<h2>Timeline</h2>

			{#if loading}
				<p class="muted">Loading…</p>
			{:else if loadError}
				<p class="error-text">{loadError}</p>
			{:else if entries.length === 0}
				<div class="empty">No communications logged for this deal.</div>
			{:else}
				<div class="timeline">
					{#each entries as entry (entry.id)}
						<div class="timeline-item">
							<div class="timeline-dot"></div>
							<div class="timeline-content card">
								<div class="timeline-header">
									<div class="timeline-left">
										<span class="channel-badge">
											{channelEmoji[entry.channel] ?? '📋'}
											{channelLabel[entry.channel] ?? entry.channel}
										</span>
										<span
											class="direction-pill"
											class:direction-inbound={entry.direction === 'inbound'}
											class:direction-outbound={entry.direction === 'outbound'}
										>
											{entry.direction}
										</span>
										{#if entry.sla_target_hours}
											<span class="sla-tag">SLA: {entry.sla_target_hours}h</span>
											{#if isOverdue(entry)}
												<span class="badge badge-overdue">Overdue</span>
											{/if}
										{/if}
									</div>
									<span class="timestamp muted">{fmtDateTime(entry.created_at)}</span>
								</div>

								{#if entry.subject}
									<p class="entry-subject">{entry.subject}</p>
								{/if}

								{#if entry.summary}
									<p class="entry-summary">{entry.summary}</p>
								{/if}

								{#if entry.contacted_by}
									<p class="entry-by muted">By: {entry.contacted_by}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.6rem;
		color: #111827;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
		color: #111827;
	}

	.section {
		margin-bottom: 2rem;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
	}

	.loader-card {
		margin-bottom: 2rem;
	}

	.loader-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	/* Form fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
		margin-bottom: 1rem;
	}

	.field-sla {
		max-width: 110px;
		flex: 0 0 110px;
	}

	.field-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
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

	.input-full {
		border-radius: 8px;
	}

	.input:focus {
		outline: 2px solid #0066cc;
		outline-offset: 1px;
	}

	.select {
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.93rem;
		min-height: 44px;
		background: #fff;
		width: 100%;
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

	.form-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.25rem;
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

	/* Timeline */
	.timeline {
		display: flex;
		flex-direction: column;
		gap: 0;
		position: relative;
		padding-left: 1.5rem;
	}

	.timeline::before {
		content: '';
		position: absolute;
		left: 0.55rem;
		top: 0.75rem;
		bottom: 0.75rem;
		width: 2px;
		background: #e5e7eb;
	}

	.timeline-item {
		display: flex;
		gap: 1rem;
		padding-bottom: 1rem;
		position: relative;
	}

	.timeline-item:last-child {
		padding-bottom: 0;
	}

	.timeline-dot {
		position: absolute;
		left: -1.5rem;
		top: 1.1rem;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #0066cc;
		border: 2px solid #fff;
		box-shadow: 0 0 0 2px #e5e7eb;
		flex-shrink: 0;
	}

	.timeline-content {
		flex: 1;
		padding: 1rem 1.25rem;
	}

	.timeline-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}

	.timeline-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.channel-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		background: #f3f4f6;
		color: #374151;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.direction-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.direction-outbound {
		background: #dcfce7;
		color: #166534;
	}

	.direction-inbound {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.sla-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		color: #6b7280;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge-overdue {
		background: #fee2e2;
		color: #b91c1c;
	}

	.timestamp {
		font-size: 0.82rem;
		white-space: nowrap;
	}

	.entry-subject {
		font-weight: 600;
		color: #111827;
		font-size: 0.95rem;
		margin: 0 0 0.4rem;
	}

	.entry-summary {
		color: #4b5563;
		font-size: 0.9rem;
		margin: 0 0 0.4rem;
		white-space: pre-wrap;
	}

	.entry-by {
		margin: 0;
		font-size: 0.83rem;
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

	.empty {
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
		color: #6b7280;
		background: #fff;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.loader-row {
			flex-direction: column;
			align-items: stretch;
		}

		.field-row {
			flex-direction: column;
		}

		.field-sla {
			max-width: 100%;
			flex: 1;
		}

		.timeline-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.timestamp {
			white-space: normal;
		}
	}
</style>
