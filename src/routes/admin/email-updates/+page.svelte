<script lang="ts">
	import { onMount } from 'svelte';

	type EmailPref = {
		id: string;
		deal_id: string;
		client_email: string;
		frequency: string;
		enabled: boolean;
		last_sent_at: string | null;
		created_at: string;
		updated_at: string;
	};

	type SentEmail = {
		id: string;
		deal_id: string;
		client_email: string;
		subject: string | null;
		status: string;
		error_message: string | null;
		created_at: string;
	};

	let prefs: EmailPref[] = [];
	let sentEmails: SentEmail[] = [];
	let loading = true;
	let error = '';
	let sendingAll = false;
	let sendResult = '';
	let previewHtml = '';
	let showPreview = false;

	const readJson = async (res: Response) => res.json().catch(() => ({}));

	const formatTimestamp = (val: string | null) => {
		if (!val) return '—';
		const d = new Date(val);
		return Number.isNaN(d.valueOf()) ? String(val) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};

	const loadData = async () => {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/admin/email-updates');
			if (!res.ok) {
				const payload = await readJson(res);
				throw new Error(payload?.error || `Failed to load (${res.status})`);
			}
			const payload = await readJson(res);
			prefs = payload?.data?.preferences || [];
			sentEmails = payload?.data?.sent_emails || [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	};

	const loadPrefs = async () => {
		try {
			const res = await fetch('/api/admin/email-updates');
			if (!res.ok) return;
			const payload = await readJson(res);
			prefs = payload?.data?.preferences || [];
			sentEmails = payload?.data?.sent_emails || [];
		} catch { /* ignore */ }
	};

	const toggleEnabled = async (pref: EmailPref) => {
		try {
			const res = await fetch(`/api/admin/email-preferences/${pref.deal_id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_email: pref.client_email, enabled: !pref.enabled })
			});
			if (!res.ok) {
				const payload = await readJson(res);
				throw new Error(payload?.error || 'Failed to toggle');
			}
			pref.enabled = !pref.enabled;
			prefs = [...prefs];
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to toggle');
		}
	};

	const updateFrequency = async (pref: EmailPref, frequency: string) => {
		try {
			const res = await fetch(`/api/admin/email-preferences/${pref.deal_id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_email: pref.client_email, frequency })
			});
			if (!res.ok) {
				const payload = await readJson(res);
				throw new Error(payload?.error || 'Failed to update');
			}
			pref.frequency = frequency;
			prefs = [...prefs];
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to update frequency');
		}
	};

	const sendNow = async () => {
		sendingAll = true;
		sendResult = '';
		try {
			const res = await fetch('/api/admin/send-updates', { method: 'POST' });
			const payload = await readJson(res);
			if (!res.ok) throw new Error(payload?.error || `Failed (${res.status})`);
			const d = payload?.data || {};
			sendResult = `Sent: ${d.sent || 0}, Skipped: ${d.skipped || 0}, Failed: ${d.failed || 0}`;
			if (d.details?.length > 0) {
				const firstSent = d.details.find((x: any) => x.html);
				if (firstSent) {
					previewHtml = firstSent.html;
				}
			}
			await loadPrefs();
		} catch (err) {
			sendResult = err instanceof Error ? err.message : 'Failed to send';
		} finally {
			sendingAll = false;
		}
	};

	onMount(loadData);
</script>

<div class="container">
	<header>
		<h1>Email Updates</h1>
		<p>Manage scheduled email updates for client projects.</p>
	</header>

	<div class="actions-bar">
		<button class="send-btn" type="button" on:click={sendNow} disabled={sendingAll}>
			{sendingAll ? 'Sending...' : 'Send Due Updates Now'}
		</button>
		{#if previewHtml}
			<button class="preview-btn" type="button" on:click={() => { showPreview = !showPreview; }}>
				{showPreview ? 'Hide Preview' : 'Show Email Preview'}
			</button>
		{/if}
	</div>

	{#if sendResult}
		<div class="result-banner">{sendResult}</div>
	{/if}

	{#if showPreview && previewHtml}
		<div class="card preview-card">
			<h2>Email Preview</h2>
			<div class="preview-frame">
				{@html previewHtml}
			</div>
		</div>
	{/if}

	{#if loading}
		<p class="muted">Loading email preferences...</p>
	{:else if error}
		<div class="card error-card">
			<p class="error-text">{error}</p>
			<button type="button" on:click={loadData}>Retry</button>
		</div>
	{:else if prefs.length === 0}
		<div class="card">
			<p class="muted">No email preferences configured yet. Preferences are created when a client's deal has an email preference set.</p>
		</div>
	{:else}
		<div class="card">
			<h2>Preferences ({prefs.length})</h2>
			<div class="pref-list">
				{#each prefs as pref (pref.id)}
					<div class="pref-item" class:disabled={!pref.enabled}>
						<div class="pref-info">
							<div class="pref-top">
								<span class="pref-deal">Deal {pref.deal_id.slice(-6)}</span>
								<span class="pref-email">{pref.client_email}</span>
							</div>
							<div class="pref-meta">
								<span>Last sent: {formatTimestamp(pref.last_sent_at)}</span>
							</div>
						</div>
						<div class="pref-controls">
							<select
								value={pref.frequency}
								on:change={(e) => updateFrequency(pref, e.currentTarget.value)}
							>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="none">None</option>
							</select>
							<button
								class="toggle-btn"
								class:active={pref.enabled}
								type="button"
								on:click={() => toggleEnabled(pref)}
							>
								{pref.enabled ? 'Enabled' : 'Disabled'}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if sentEmails.length > 0}
		<div class="card sent-card">
			<h2>Recent Sent Emails</h2>
			<div class="sent-list">
				{#each sentEmails as email (email.id)}
					<div class="sent-item">
						<div class="sent-info">
							<span class="sent-subject">{email.subject || 'No subject'}</span>
							<span class="sent-to">{email.client_email}</span>
						</div>
						<div class="sent-meta">
							<span class="badge status-{email.status}">{email.status}</span>
							<span class="sent-time">{formatTimestamp(email.created_at)}</span>
						</div>
						{#if email.error_message}
							<p class="sent-error">{email.error_message}</p>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		margin-bottom: 2rem;
	}

	header h1 {
		margin: 0 0 0.35rem;
	}

	header p {
		margin: 0;
		color: #6b7280;
	}

	.actions-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.send-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0066cc;
		color: #fff;
		border: none;
		border-radius: 10px;
		padding: 0.85rem 1.25rem;
		min-height: 44px;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
	}

	.send-btn:hover:not(:disabled) {
		background: #0052a3;
	}

	.send-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.preview-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #f9fafb;
		color: #111827;
		border: 1px solid #d1d5db;
		border-radius: 10px;
		padding: 0.85rem 1.25rem;
		min-height: 44px;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
	}

	.preview-btn:hover {
		background: #f3f4f6;
	}

	.result-banner {
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.5rem;
		font-weight: 600;
	}

	.card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
		margin-bottom: 1.5rem;
	}

	.card h2 {
		margin-top: 0;
		margin-bottom: 1rem;
	}

	.muted {
		color: #6b7280;
		margin: 0;
	}

	.error-text {
		color: #b91c1c;
		margin: 0 0 0.75rem;
	}

	.error-card {
		border-color: #fecaca;
		background: #fef2f2;
	}

	.pref-list {
		display: grid;
		gap: 0.75rem;
	}

	.pref-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		flex-wrap: wrap;
	}

	.pref-item.disabled {
		opacity: 0.55;
	}

	.pref-info {
		display: grid;
		gap: 0.3rem;
	}

	.pref-top {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.pref-deal {
		font-weight: 700;
		color: #111827;
	}

	.pref-email {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.pref-meta {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.pref-controls {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.pref-controls select {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		min-height: 40px;
		font-size: 0.95rem;
	}

	.toggle-btn {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: 1px solid #d1d5db;
		background: #f3f4f6;
		font-weight: 700;
		font-size: 0.85rem;
		min-height: 40px;
		cursor: pointer;
		color: #6b7280;
	}

	.toggle-btn.active {
		background: #d1fae5;
		border-color: #a7f3d0;
		color: #065f46;
	}

	.preview-card {
		overflow: hidden;
	}

	.preview-frame {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: auto;
		max-height: 600px;
	}

	.sent-card h2 {
		margin-bottom: 1rem;
	}

	.sent-list {
		display: grid;
		gap: 0.65rem;
	}

	.sent-item {
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}

	.sent-info {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 0.35rem;
	}

	.sent-subject {
		font-weight: 600;
		color: #111827;
	}

	.sent-to {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.sent-meta {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.sent-time {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.sent-error {
		margin: 0.5rem 0 0;
		color: #b91c1c;
		font-size: 0.9rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: capitalize;
	}

	.status-sent {
		background: #d1fae5;
		color: #065f46;
	}

	.status-failed {
		background: #fee2e2;
		color: #b91c1c;
	}

	.status-skipped {
		background: #fef3c7;
		color: #92400e;
	}

	@media (max-width: 720px) {
		.container {
			padding: 1.5rem 1.25rem;
		}

		.pref-item {
			flex-direction: column;
			align-items: stretch;
		}

		.pref-controls {
			justify-content: stretch;
		}

		.pref-controls select,
		.toggle-btn {
			flex: 1;
		}

		.actions-bar {
			flex-direction: column;
		}

		.send-btn,
		.preview-btn {
			width: 100%;
		}
	}
</style>
