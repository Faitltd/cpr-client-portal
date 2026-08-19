<script lang="ts">
	import { onMount } from 'svelte';
	import type { DesignerDealSummary, DesignerNote } from '$lib/types/designer';

	// Clean inline detail for the Pipeline list — a light summary of the deal
	// plus its notes (view + add). Deliberately NOT the heavy CRM DealCard.
	export let deal: DesignerDealSummary;

	let notes: DesignerNote[] = [];
	let loadingNotes = true;
	let notesError = '';

	let composer = '';
	let submitting = false;
	let submitError = '';

	const asText = (v: unknown): string | null =>
		typeof v === 'string' && v.trim()
			? v.trim()
			: typeof v === 'number'
				? String(v)
				: null;

	function asMoney(v: unknown): string | null {
		const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
		return Number.isFinite(n) && n !== 0
			? new Intl.NumberFormat('en-US', {
					style: 'currency',
					currency: 'USD',
					maximumFractionDigits: 0
				}).format(n)
			: null;
	}

	$: f = (deal.fields ?? {}) as Record<string, unknown>;

	// Key facts — only the ones that actually have a value are shown.
	$: facts = (
		[
			['Contact', deal.contactName],
			['Account', deal.accountName],
			['Address', deal.address],
			['Ball in court', deal.ballInCourt],
			['Amount', asMoney(f.Amount)],
			['Closing', asText(f.Closing_Date)],
			['WiFi', asText(f.WiFi)],
			['Garage code', asText(f.Garage_Code)]
		] as [string, string | null][]
	).filter(([, v]) => v);

	$: description = asText(f.Refined_Scope) ?? asText(f.Description);
	$: accessNotes = asText(f.Access_Notes);

	const fmtTime = (v: string | null | undefined) => {
		if (!v) return '';
		const d = new Date(v);
		return Number.isNaN(d.valueOf())
			? ''
			: d.toLocaleString('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				});
	};

	async function loadNotes() {
		loadingNotes = true;
		notesError = '';
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}/notes`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				notesError = data.message || `Couldn't load notes (${res.status}).`;
				return;
			}
			notes = Array.isArray(data.notes) ? data.notes : [];
		} catch (err) {
			notesError = err instanceof Error ? err.message : "Couldn't load notes.";
		} finally {
			loadingNotes = false;
		}
	}

	async function addNote(event?: Event) {
		event?.preventDefault();
		const content = composer.trim();
		if (!content || submitting) return;
		submitting = true;
		submitError = '';
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				submitError = data.message || `Couldn't save note (${res.status}).`;
				return;
			}
			if (data.note) notes = [data.note, ...notes];
			composer = '';
		} catch (err) {
			submitError = err instanceof Error ? err.message : "Couldn't save note.";
		} finally {
			submitting = false;
		}
	}

	onMount(loadNotes);
</script>

<div class="detail">
	{#if facts.length}
		<dl class="facts">
			{#each facts as [label, value]}
				<div class="fact">
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if deal.ballInCourtNote}
		<p class="para"><span class="para-label">Ball-in-court note</span>{deal.ballInCourtNote}</p>
	{/if}
	{#if accessNotes}
		<p class="para"><span class="para-label">Access</span>{accessNotes}</p>
	{/if}
	{#if description}
		<p class="para"><span class="para-label">Scope</span>{description}</p>
	{/if}

	<div class="notes">
		<div class="notes-head">Notes</div>
		<form class="composer" on:submit={addNote}>
			<textarea bind:value={composer} rows="2" placeholder="Add a note…"></textarea>
			<button type="submit" disabled={submitting || !composer.trim()}>
				{submitting ? 'Saving…' : 'Add note'}
			</button>
		</form>
		{#if submitError}<p class="err">{submitError}</p>{/if}

		{#if loadingNotes}
			<p class="muted">Loading notes…</p>
		{:else if notesError}
			<p class="err">{notesError}</p>
		{:else if notes.length === 0}
			<p class="muted">No notes yet.</p>
		{:else}
			<ul class="note-list">
				{#each notes as n (n.id)}
					<li>
						{#if n.Note_Title}<div class="note-title">{n.Note_Title}</div>{/if}
						<div class="note-body">{n.Note_Content}</div>
						<div class="note-meta">
							{n.owner_name ?? ''}{n.owner_name && n.Created_Time ? ' · ' : ''}{fmtTime(n.Created_Time)}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem 1.25rem;
		margin: 0;
	}

	.fact dt {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		font-weight: 700;
	}

	.fact dd {
		margin: 0.1rem 0 0;
		font-size: 0.9rem;
		color: #0f172a;
		white-space: normal;
	}

	.para {
		margin: 0;
		font-size: 0.9rem;
		color: #1f2937;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.para-label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		font-weight: 700;
		margin-bottom: 0.15rem;
	}

	.notes {
		border-top: 1px solid #e5e7eb;
		padding-top: 0.75rem;
	}

	.notes-head {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
		margin-bottom: 0.75rem;
	}

	.composer textarea {
		flex: 1;
		resize: vertical;
		padding: 0.5rem 0.6rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font: inherit;
		font-size: 0.9rem;
	}

	.composer button {
		padding: 0.5rem 0.9rem;
		border: none;
		border-radius: 8px;
		background: #111827;
		color: #fff;
		font: inherit;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.composer button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.note-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.note-list li {
		border: 1px solid #eef2f7;
		border-radius: 8px;
		background: #fff;
		padding: 0.55rem 0.7rem;
	}

	.note-title {
		font-weight: 600;
		font-size: 0.85rem;
		color: #0f172a;
		margin-bottom: 0.15rem;
	}

	.note-body {
		font-size: 0.9rem;
		color: #1f2937;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.note-meta {
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.muted {
		margin: 0;
		color: #6b7280;
		font-size: 0.88rem;
	}

	.err {
		margin: 0 0 0.5rem;
		color: #b91c1c;
		font-size: 0.85rem;
	}
</style>
