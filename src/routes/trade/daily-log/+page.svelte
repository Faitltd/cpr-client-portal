<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	export let data: {
		tradePartner: { name?: string | null; email: string };
		deals: any[];
		warning?: string;
	};

	const deals = Array.isArray(data?.deals) ? data.deals : [];
	let selectedDealId = deals[0]?.id || '';

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

	// Form state
	const today = new Date().toISOString().split('T')[0];
	let logDate = today;
	let hoursWorked: number | '' = '';
	let workCompleted = '';
	let workPlanned = '';
	let issuesEncountered = '';
	let weatherDelay = false;

	let submitting = false;
	let successMessage = '';
	let errorMessage = '';

	const handleSubmit = async () => {
		if (!selectedDealId) {
			errorMessage = 'Please select a deal first.';
			return;
		}
		submitting = true;
		successMessage = '';
		errorMessage = '';

		try {
			const res = await fetch('/api/trade/daily-log', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dealId: selectedDealId,
					logDate,
					hoursWorked: hoursWorked === '' ? undefined : hoursWorked,
					workCompleted,
					workPlanned,
					issuesEncountered,
					weatherDelay
				})
			});

			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.message || `Request failed (${res.status})`);
			}

			successMessage = 'Daily log submitted successfully!';
			await loadLogs(selectedDealId);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to submit daily log.';
		} finally {
			submitting = false;
		}
	};

	// Previous logs
	type DailyLog = {
		id: string;
		log_date: string;
		hours_worked: number | null;
		work_completed: string | null;
		work_planned: string | null;
		issues_encountered: string | null;
		weather_delay: boolean | null;
	};

	let logs: DailyLog[] = [];
	let logsLoading = false;
	let logsError = '';
	let lastLogsDealId = '';
	let logsController: AbortController | null = null;

	const loadLogs = async (dealId: string) => {
		if (!dealId) return;
		logsController?.abort();
		logsController = new AbortController();
		logsLoading = true;
		logsError = '';

		try {
			const res = await fetch(`/api/trade/daily-log?dealId=${encodeURIComponent(dealId)}`, {
				signal: logsController.signal
			});
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.message || `Failed to fetch logs (${res.status})`);
			}
			const payload = await res.json().catch(() => ({}));
			logs = Array.isArray(payload?.data) ? payload.data.slice(0, 7) : [];
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			logsError = err instanceof Error ? err.message : 'Failed to fetch logs.';
			logs = [];
		} finally {
			logsLoading = false;
		}
	};

	$: if (browser && selectedDealId && selectedDealId !== lastLogsDealId) {
		lastLogsDealId = selectedDealId;
		loadLogs(selectedDealId);
	}

	onDestroy(() => logsController?.abort());

	const formatLogDate = (dateStr: string) => {
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	};
</script>

<div class="dashboard">
	<header>
		<a class="back-link" href="/trade/dashboard">← Back to Dashboard</a>
		<h1>Daily Log</h1>
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
			<h2>Submit Daily Log</h2>

			{#if successMessage}
				<div class="success-message">{successMessage}</div>
			{/if}
			{#if errorMessage}
				<div class="error-message">{errorMessage}</div>
			{/if}

			<form on:submit|preventDefault={handleSubmit}>
				<div class="form-field">
					<label for="log-date">Date</label>
					<input id="log-date" type="date" bind:value={logDate} required />
				</div>

				<div class="form-field">
					<label for="hours-worked">Hours Worked</label>
					<input
						id="hours-worked"
						type="number"
						step="0.5"
						min="0"
						max="24"
						bind:value={hoursWorked}
						placeholder="e.g. 8"
					/>
				</div>

				<div class="form-field">
					<label for="work-completed">Work Completed</label>
					<textarea
						id="work-completed"
						bind:value={workCompleted}
						placeholder="What did you accomplish today?"
					></textarea>
				</div>

				<div class="form-field">
					<label for="work-planned">Work Planned</label>
					<textarea
						id="work-planned"
						bind:value={workPlanned}
						placeholder="What's planned for tomorrow?"
					></textarea>
				</div>

				<div class="form-field">
					<label for="issues-encountered">Issues / Blockers</label>
					<textarea
						id="issues-encountered"
						bind:value={issuesEncountered}
						placeholder="Any issues or blockers? (optional)"
					></textarea>
				</div>

				<div class="form-field form-field-checkbox">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={weatherDelay} />
						Weather delayed work today
					</label>
				</div>

				<button class="submit-button" type="submit" disabled={submitting}>
					{submitting ? 'Submitting…' : 'Submit Daily Log'}
				</button>
			</form>
		</div>

		<div class="card logs-card">
			<h2>Previous Logs</h2>

			{#if logsLoading}
				<p class="muted">Loading logs…</p>
			{:else if logsError}
				<p class="error-text">{logsError}</p>
			{:else if logs.length === 0}
				<p class="muted">No logs submitted for this deal yet.</p>
			{:else}
				<div class="logs-list">
					{#each logs as log (log.id)}
						<details class="log-item">
							<summary class="log-summary">
								<span class="log-date">{formatLogDate(log.log_date)}</span>
								{#if log.hours_worked != null}
									<span class="log-hours">{log.hours_worked}h</span>
								{/if}
								{#if log.weather_delay}
									<span class="weather-badge">Weather Delay</span>
								{/if}
								{#if log.work_completed}
									<span class="log-preview">{log.work_completed.slice(0, 100)}{log.work_completed.length > 100 ? '…' : ''}</span>
								{/if}
							</summary>
							<div class="log-detail">
								{#if log.work_completed}
									<div class="log-section">
										<h4>Work Completed</h4>
										<p>{log.work_completed}</p>
									</div>
								{/if}
								{#if log.work_planned}
									<div class="log-section">
										<h4>Work Planned</h4>
										<p>{log.work_planned}</p>
									</div>
								{/if}
								{#if log.issues_encountered}
									<div class="log-section">
										<h4>Issues / Blockers</h4>
										<p>{log.issues_encountered}</p>
									</div>
								{/if}
							</div>
						</details>
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

	select {
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 1rem;
		width: 100%;
		min-height: 44px;
	}

	.form-card h2,
	.logs-card h2 {
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

	.form-field input[type='date'],
	.form-field input[type='number'] {
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		min-height: 44px;
		width: 100%;
		font-size: 1rem;
		box-sizing: border-box;
	}

	.form-field textarea {
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		min-height: 100px;
		resize: vertical;
		width: 100%;
		font-size: 1rem;
		font-family: inherit;
		box-sizing: border-box;
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
		opacity: 0.6;
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

	.logs-list {
		display: grid;
		gap: 0.75rem;
	}

	.log-item {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
	}

	.log-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		cursor: pointer;
		list-style: none;
		background: #f9fafb;
	}

	.log-summary::-webkit-details-marker {
		display: none;
	}

	.log-summary::before {
		content: '▶';
		font-size: 0.65rem;
		color: #6b7280;
		flex-shrink: 0;
	}

	details[open] .log-summary::before {
		content: '▼';
	}

	.log-date {
		font-weight: 700;
		color: #111827;
		font-size: 0.95rem;
	}

	.log-hours {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #111827;
		color: #fff;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.weather-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.8rem;
		font-weight: 700;
		border: 1px solid #fcd34d;
	}

	.log-preview {
		color: #6b7280;
		font-size: 0.9rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.log-detail {
		padding: 1rem;
		border-top: 1px solid #e5e7eb;
		display: grid;
		gap: 0.85rem;
	}

	.log-section h4 {
		margin: 0 0 0.3rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
	}

	.log-section p {
		margin: 0;
		color: #111827;
		white-space: pre-wrap;
		line-height: 1.45;
	}

	@media (max-width: 720px) {
		.dashboard {
			padding: 1.5rem 1.25rem;
		}

		.card {
			padding: 1.25rem;
		}

		.submit-button {
			width: 100%;
		}
	}
</style>
