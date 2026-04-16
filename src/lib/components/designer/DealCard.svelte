<script lang="ts">
	import { createEventDispatcher, tick } from 'svelte';
	import type {
		DealFieldDescriptor,
		DealFieldGroup,
		DealFieldKind,
		DesignerDealSummary,
		DesignerNote
	} from '$lib/types/designer';
	import {
		formatAbsoluteTimestamp,
		formatCompactTimestamp,
		formatRelativeTime
	} from './note-format';

	export let deal: DesignerDealSummary;
	export let fieldDescriptors: DealFieldDescriptor[];
	export let expanded = false;

	let notes: DesignerNote[] = [];
	let loadingNotes = false;
	let notesError = '';

	let composerText = '';
	let composerBusy = false;
	let composerError = '';
	let composerTextarea: HTMLTextAreaElement | null = null;
	let justSavedFlash = false;

	let draft: Record<string, string> = {};
	let saving = false;
	let savedAt: number | null = null;
	let saveError = '';

	let historyOpen = false;

	// Inline Ball-in-court editor in the summary row — small text field that saves
	// on blur/Enter and propagates the updated deal back to the parent.
	let ballInCourtDraft: string = deal.ballInCourt ?? '';
	let savingBallInCourt = false;
	let ballInCourtError = '';
	let ballInCourtSavedAt: number | null = null;

	const dispatch = createEventDispatcher<{
		dealUpdated: { dealId: string; deal: DesignerDealSummary };
	}>();

	$: latestNote = notes[0] ?? null;
	$: olderNotes = notes.slice(1);

	// All descriptors — we render every one. The form treats non-editable
	// descriptors as display-only. The server still enforces the whitelist.
	$: groupedFields = groupByOrder(fieldDescriptors);

	// Fields with a dedicated inline editor in the summary row — skip rendering
	// them inside the expanded Deal editor so there's only one input per field.
	const INLINE_HEADER_FIELD_KEYS = new Set(['Ball_In_Court']);

	const GROUP_ORDER: DealFieldGroup[] = ['core', 'scope', 'address', 'access', 'system'];
	const GROUP_LABEL: Record<DealFieldGroup, string> = {
		core: 'Core',
		scope: 'Scope',
		address: 'Address',
		access: 'Access & links',
		system: 'System (read-only)'
	};

	function groupByOrder(all: DealFieldDescriptor[]) {
		const map = new Map<DealFieldGroup, DealFieldDescriptor[]>();
		for (const group of GROUP_ORDER) map.set(group, []);
		for (const d of all) {
			if (INLINE_HEADER_FIELD_KEYS.has(d.key)) continue;
			const bucket = map.get(d.group) ?? [];
			bucket.push(d);
			map.set(d.group, bucket);
		}
		return GROUP_ORDER.map((group) => ({ group, fields: map.get(group) ?? [] })).filter(
			(g) => g.fields.length > 0
		);
	}

	function readValue(key: string): unknown {
		return (deal.fields as any)[key];
	}

	function coerceToInputString(value: unknown, kind: DealFieldKind): string {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'number') return String(value);
		if (typeof value === 'boolean') return String(value);
		if (typeof value === 'object') {
			const obj = value as any;
			const name = obj.name ?? obj.display_value ?? obj.value ?? '';
			if (kind === 'readonly' || kind === 'lookup-readonly') {
				return typeof name === 'string' ? name : '';
			}
			return typeof name === 'string' ? name : '';
		}
		return '';
	}

	function seedDraft() {
		const next: Record<string, string> = {};
		for (const d of fieldDescriptors) {
			if (!d.editable) continue;
			next[d.key] = coerceToInputString(readValue(d.key), d.kind);
		}
		draft = next;
	}

	function coerceOutgoing(raw: string, kind: DealFieldKind): unknown {
		const trimmed = raw.trim();
		if (kind === 'number' || kind === 'currency') {
			if (trimmed === '') return null;
			const n = Number(trimmed);
			return Number.isFinite(n) ? n : null;
		}
		if (kind === 'date') {
			return trimmed === '' ? null : trimmed;
		}
		return raw;
	}

	function currentValueMatches(key: string, kind: DealFieldKind, nextRaw: string): boolean {
		const current = coerceToInputString(readValue(key), kind);
		return current === nextRaw;
	}

	async function loadNotes() {
		loadingNotes = true;
		notesError = '';
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}/notes`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				notesError = data.message || `Failed to load notes (${res.status})`;
				return;
			}
			notes = Array.isArray(data.notes) ? data.notes : [];
		} catch (err) {
			notesError = err instanceof Error ? err.message : 'Failed to load notes';
		} finally {
			loadingNotes = false;
		}
	}

	async function toggle() {
		expanded = !expanded;
		if (expanded) {
			if (notes.length === 0 && !notesError && !loadingNotes) void loadNotes();
			if (Object.keys(draft).length === 0) seedDraft();
			await tick();
			composerTextarea?.focus({ preventScroll: true });
		}
	}

	async function submitNote(event?: Event) {
		event?.preventDefault();
		const content = composerText.trim();
		if (!content || composerBusy) return;
		composerBusy = true;
		composerError = '';
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				composerError = data.message || `Failed to save note (${res.status})`;
				return;
			}
			if (data?.note) {
				notes = [data.note, ...notes];
				composerText = '';
				justSavedFlash = true;
				setTimeout(() => (justSavedFlash = false), 1500);
				await tick();
				composerTextarea?.focus({ preventScroll: true });
			}
		} catch (err) {
			composerError = err instanceof Error ? err.message : 'Failed to save note';
		} finally {
			composerBusy = false;
		}
	}

	function onComposerKey(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void submitNote();
		}
	}

	function buildDelta(): Record<string, unknown> {
		const delta: Record<string, unknown> = {};
		for (const d of fieldDescriptors) {
			if (!d.editable) continue;
			const raw = draft[d.key] ?? '';
			if (currentValueMatches(d.key, d.kind, raw)) continue;
			delta[d.key] = coerceOutgoing(raw, d.kind);
		}
		return delta;
	}

	async function saveFields(event: Event) {
		event.preventDefault();
		if (saving) return;
		const delta = buildDelta();
		if (Object.keys(delta).length === 0) {
			saveError = 'No field changes to save.';
			return;
		}
		saving = true;
		saveError = '';
		savedAt = null;
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fields: delta })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				saveError = data.message || `Failed to save (${res.status})`;
				return;
			}
			savedAt = Date.now();
			const updatedDeal: DesignerDealSummary = data?.deal ?? {
				...deal,
				fields: { ...deal.fields, ...delta }
			};
			dispatch('dealUpdated', { dealId: deal.id, deal: updatedDeal });
			// Re-seed draft from the server-authoritative fields so subsequent
			// delta calculations compare against the saved state.
			await tick();
			seedDraft();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	async function commitBallInCourt() {
		const next = ballInCourtDraft.trim();
		const current = (deal.ballInCourt ?? '').trim();
		if (next === current) return;
		savingBallInCourt = true;
		ballInCourtError = '';
		ballInCourtSavedAt = null;
		try {
			const res = await fetch(`/api/designer/deals/${encodeURIComponent(deal.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fields: { Ball_In_Court: next === '' ? null : next } })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				ballInCourtError = data.message || `Failed to save (${res.status})`;
				ballInCourtDraft = deal.ballInCourt ?? '';
				return;
			}
			const updatedDeal: DesignerDealSummary | undefined = data?.deal;
			if (updatedDeal) {
				ballInCourtDraft = updatedDeal.ballInCourt ?? '';
				dispatch('dealUpdated', { dealId: deal.id, deal: updatedDeal });
			} else {
				ballInCourtDraft = next;
			}
			ballInCourtSavedAt = Date.now();
			setTimeout(() => {
				ballInCourtSavedAt = null;
			}, 1800);
		} catch (err) {
			ballInCourtError = err instanceof Error ? err.message : 'Failed to save';
			ballInCourtDraft = deal.ballInCourt ?? '';
		} finally {
			savingBallInCourt = false;
		}
	}

	function onBallInCourtKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			(event.target as HTMLInputElement).blur();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			ballInCourtDraft = deal.ballInCourt ?? '';
			ballInCourtError = '';
			(event.target as HTMLInputElement).blur();
		}
	}

	function onHeaderKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			// Don't toggle when the keystroke is coming from the inline editor.
			const target = event.target as HTMLElement | null;
			if (target && target.closest('.bic-cell')) return;
			event.preventDefault();
			void toggle();
		}
	}
</script>

<section class="card" aria-labelledby={`deal-${deal.id}-title`} class:expanded>
	<div
		class="header"
		role="button"
		tabindex="0"
		aria-expanded={expanded}
		aria-controls={`deal-${deal.id}-body`}
		on:click={toggle}
		on:keydown={onHeaderKey}
	>
		<div class="header-main">
			<div class="header-top">
				<h2 id={`deal-${deal.id}-title`}>{deal.name}</h2>
				{#if deal.stage}
					<span class="badge stage">{deal.stage}</span>
				{/if}
			</div>
			<dl class="header-meta">
				{#if deal.contactName}
					<div><dt>Client</dt><dd>{deal.contactName}</dd></div>
				{/if}
				{#if deal.accountName && deal.accountName !== deal.contactName}
					<div><dt>Account</dt><dd>{deal.accountName}</dd></div>
				{/if}
				<div
					class="bic-cell"
					on:click|stopPropagation
					on:keydown|stopPropagation
					role="presentation"
				>
					<dt>
						<label for={`bic-${deal.id}`}>Ball in court</label>
					</dt>
					<dd>
						<input
							id={`bic-${deal.id}`}
							class="bic-input"
							type="text"
							bind:value={ballInCourtDraft}
							on:blur={commitBallInCourt}
							on:keydown={onBallInCourtKey}
							placeholder="—"
							disabled={savingBallInCourt}
							aria-busy={savingBallInCourt}
						/>
						{#if savingBallInCourt}
							<span class="bic-status" aria-live="polite">Saving…</span>
						{:else if ballInCourtError}
							<span class="bic-status error" role="alert">{ballInCourtError}</span>
						{:else if ballInCourtSavedAt}
							<span class="bic-status success" role="status">Saved</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt>Latest note</dt>
					<dd>
						{latestNote?.Created_Time ? formatRelativeTime(latestNote.Created_Time) : '—'}
					</dd>
				</div>
			</dl>
		</div>
		<span class="chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
	</div>

	{#if expanded}
		<div class="body" id={`deal-${deal.id}-body`}>
			<!-- 1. Hero: latest note -->
			<section class="latest-note-hero" aria-label="Latest note" class:flash={justSavedFlash}>
				<header class="latest-head">
					<h3>Latest note</h3>
					{#if latestNote?.Created_Time}
						<time
							class="latest-time"
							datetime={latestNote.Created_Time}
							title={formatAbsoluteTimestamp(latestNote.Created_Time)}
						>
							<span class="rel">{formatRelativeTime(latestNote.Created_Time)}</span>
							<span class="abs">{formatAbsoluteTimestamp(latestNote.Created_Time)}</span>
						</time>
					{/if}
				</header>

				{#if loadingNotes && notes.length === 0}
					<p class="hero-state loading">Loading notes…</p>
				{:else if notesError}
					<p class="hero-state error" role="alert">
						{notesError}
						<button type="button" class="link" on:click={loadNotes}>Retry</button>
					</p>
				{:else if latestNote}
					<p class="hero-body">{latestNote.Note_Content}</p>
					{#if latestNote.owner_name}
						<p class="hero-author">— {latestNote.owner_name}</p>
					{/if}
				{:else}
					<div class="hero-empty">
						<p class="hero-empty-title">No notes yet</p>
						<p class="hero-empty-sub">Add the first note below to start a history.</p>
					</div>
				{/if}
			</section>

			<!-- 2. Composer -->
			<form class="composer" on:submit={submitNote} aria-label="Add note">
				<label for={`note-${deal.id}`} class="composer-label">Add a note</label>
				<textarea
					id={`note-${deal.id}`}
					bind:this={composerTextarea}
					bind:value={composerText}
					on:keydown={onComposerKey}
					rows="3"
					placeholder="What's the latest? (Cmd/Ctrl+Enter to save)"
					disabled={composerBusy}
				></textarea>
				<div class="composer-row">
					<button
						type="submit"
						class="primary"
						disabled={composerBusy || composerText.trim().length === 0}
					>
						{composerBusy ? 'Saving…' : 'Save note'}
					</button>
					<span class="composer-hint" aria-hidden="true">⌘/Ctrl + Enter</span>
					{#if composerError}
						<span class="error" role="alert">{composerError}</span>
					{/if}
				</div>
			</form>

			<!-- 3. History -->
			<section class="history" aria-label="Note history">
				<header class="history-head">
					<h3>Earlier notes</h3>
					{#if olderNotes.length > 3}
						<button
							type="button"
							class="link"
							on:click={() => (historyOpen = !historyOpen)}
							aria-expanded={historyOpen}
						>
							{historyOpen ? 'Show fewer' : `Show all ${olderNotes.length}`}
						</button>
					{/if}
				</header>
				{#if loadingNotes && notes.length === 0}
					<p class="muted">Loading…</p>
				{:else if olderNotes.length === 0}
					<p class="muted">No earlier notes.</p>
				{:else}
					<ol class="history-list">
						{#each (historyOpen ? olderNotes : olderNotes.slice(0, 3)) as note (note.id)}
							<li>
								<time
									datetime={note.Created_Time ?? ''}
									title={formatAbsoluteTimestamp(note.Created_Time)}
								>
									{formatCompactTimestamp(note.Created_Time)}
								</time>
								{#if note.owner_name}
									<span class="author">· {note.owner_name}</span>
								{/if}
								<p>{note.Note_Content}</p>
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<!-- 4. Editable deal fields -->
			<details class="fields-wrap">
				<summary>Deal fields</summary>
				<form class="fields" on:submit={saveFields} aria-label="Edit deal fields">
					{#each groupedFields as group}
						<fieldset class="field-group">
							<legend>{GROUP_LABEL[group.group]}</legend>
							<div class="fields-grid">
								{#each group.fields as d (d.key)}
									<label class:readonly={!d.editable}>
										<span>{d.label}</span>
										{#if d.kind === 'textarea' && d.editable}
											<textarea rows="3" bind:value={draft[d.key]}></textarea>
										{:else if d.kind === 'currency' && d.editable}
											<input type="number" step="0.01" inputmode="decimal" bind:value={draft[d.key]} />
										{:else if d.kind === 'number' && d.editable}
											<input type="number" inputmode="decimal" bind:value={draft[d.key]} />
										{:else if d.kind === 'date' && d.editable}
											<input type="date" bind:value={draft[d.key]} />
										{:else if d.editable}
											<input type="text" bind:value={draft[d.key]} />
										{:else if d.kind === 'readonly'}
											<input
												type="text"
												value={coerceToInputString(readValue(d.key), d.kind)}
												readonly
												disabled
											/>
										{:else}
											<input
												type="text"
												value={coerceToInputString(readValue(d.key), d.kind)}
												readonly
												disabled
											/>
											<small class="muted">Read-only here (lookup)</small>
										{/if}
										{#if d.helpText}
											<small class="muted help">{d.helpText}</small>
										{/if}
									</label>
								{/each}
							</div>
						</fieldset>
					{/each}
					<div class="save-row">
						<button type="submit" disabled={saving}>
							{saving ? 'Saving…' : 'Save field changes'}
						</button>
						{#if saveError}
							<span class="error" role="alert">{saveError}</span>
						{:else if savedAt}
							<span class="success" role="status">Saved</span>
						{/if}
					</div>
				</form>
			</details>

			<!-- 5. WorkDrive link -->
			<section class="workdrive" aria-label="WorkDrive">
				{#if deal.workdriveUrl}
					<a class="wd-link" href={deal.workdriveUrl} target="_blank" rel="noopener noreferrer">
						Open WorkDrive folder ↗
					</a>
				{:else}
					<p class="muted">No WorkDrive folder URL on this deal.</p>
				{/if}
			</section>
		</div>
	{/if}
</section>

<style>
	.card {
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		background: #fff;
		overflow: hidden;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.card.expanded {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
	}

	.header {
		all: unset;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		padding: 1rem 1.25rem;
		cursor: pointer;
		box-sizing: border-box;
	}

	.header:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: -2px;
	}

	.header-main {
		flex: 1;
		min-width: 0;
	}

	.header-top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	h2 {
		font-size: 1.05rem;
		margin: 0;
		font-weight: 700;
		color: #111827;
	}

	.badge.stage {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: #eef2ff;
		color: #3730a3;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.header-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.25rem 1rem;
		margin: 0.5rem 0 0 0;
	}

	.header-meta div {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
	}

	.header-meta dt {
		font-weight: 600;
		color: #6b7280;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.header-meta dd {
		margin: 0;
		color: #111827;
	}

	.chevron {
		font-size: 0.9rem;
		color: #6b7280;
		padding-top: 0.2rem;
	}

	/* Inline Ball-in-court editor lives in the summary row and must not trigger
	   the header toggle when interacted with. */
	.bic-cell {
		cursor: text;
	}

	.bic-input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid transparent;
		background: transparent;
		padding: 0.2rem 0.35rem;
		margin: -0.2rem -0.35rem;
		font: inherit;
		color: #111827;
		border-radius: 4px;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.bic-input::placeholder {
		color: #9ca3af;
	}

	.bic-input:hover:not(:disabled) {
		border-color: #d1d5db;
		background: #fff;
	}

	.bic-input:focus {
		outline: none;
		border-color: #2563eb;
		background: #fff;
	}

	.bic-input:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.bic-status {
		display: inline-block;
		font-size: 0.7rem;
		margin-top: 0.15rem;
		color: #6b7280;
	}

	.bic-status.error {
		color: #b91c1c;
	}

	.bic-status.success {
		color: #047857;
	}

	.body {
		border-top: 1px solid #eef0f3;
		padding: 1.25rem;
		display: grid;
		gap: 1.25rem;
	}

	/* Latest-note hero */

	.latest-note-hero {
		background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%);
		border: 1px solid #fcd34d;
		border-radius: 10px;
		padding: 1.1rem 1.25rem;
		display: grid;
		gap: 0.6rem;
		transition: box-shadow 0.25s ease, transform 0.25s ease;
	}

	.latest-note-hero.flash {
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.35);
	}

	.latest-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.latest-head h3 {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #92400e;
		font-weight: 700;
	}

	.latest-time {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.1;
	}

	.latest-time .rel {
		font-size: 1rem;
		font-weight: 700;
		color: #78350f;
	}

	.latest-time .abs {
		font-size: 0.72rem;
		color: #92400e;
	}

	.hero-body {
		margin: 0;
		white-space: pre-wrap;
		color: #1f2937;
		font-size: 1.05rem;
		line-height: 1.55;
		font-weight: 500;
	}

	.hero-author {
		margin: 0;
		color: #78350f;
		font-size: 0.85rem;
		font-style: italic;
	}

	.hero-state {
		margin: 0;
		color: #78350f;
		font-size: 0.95rem;
	}

	.hero-state.error {
		color: #b91c1c;
	}

	.hero-empty {
		text-align: center;
		padding: 0.35rem 0;
	}

	.hero-empty-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #78350f;
	}

	.hero-empty-sub {
		margin: 0.2rem 0 0 0;
		color: #92400e;
		font-size: 0.9rem;
	}

	/* Composer */

	.composer {
		display: grid;
		gap: 0.4rem;
	}

	.composer-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #374151;
		font-weight: 700;
	}

	.composer textarea {
		width: 100%;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 0.7rem 0.85rem;
		font: inherit;
		min-height: 76px;
		box-sizing: border-box;
		resize: vertical;
	}

	.composer textarea:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
		border-color: #2563eb;
	}

	.composer-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.composer-hint {
		font-size: 0.72rem;
		color: #6b7280;
	}

	.primary {
		background: #b45309;
		color: #fff;
		border: none;
		padding: 0.55rem 1rem;
		border-radius: 6px;
		font-weight: 700;
		cursor: pointer;
	}

	.primary:hover:not(:disabled) {
		background: #92400e;
	}

	button {
		background: #111827;
		color: #fff;
		border: none;
		padding: 0.5rem 0.85rem;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* History */

	.history {
		display: grid;
		gap: 0.4rem;
	}

	.history-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.history-head h3 {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		font-weight: 700;
	}

	.history-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.6rem;
	}

	.history-list li {
		border-left: 3px solid #e5e7eb;
		padding: 0.35rem 0.9rem;
	}

	.history-list time {
		font-size: 0.8rem;
		color: #374151;
		font-weight: 600;
	}

	.history-list .author {
		font-size: 0.8rem;
		color: #6b7280;
		margin-left: 0.2rem;
	}

	.history-list p {
		margin: 0.2rem 0 0 0;
		white-space: pre-wrap;
		font-size: 0.92rem;
		color: #111827;
	}

	.link {
		background: none;
		border: none;
		padding: 0;
		color: #1d4ed8;
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.link:hover {
		color: #1e3a8a;
	}

	/* Fields */

	.fields-wrap {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: #f9fafb;
	}

	.fields-wrap > summary {
		cursor: pointer;
		padding: 0.65rem 0.9rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #374151;
		font-weight: 700;
		list-style: none;
	}

	.fields-wrap > summary::-webkit-details-marker {
		display: none;
	}

	.fields-wrap > summary::after {
		content: ' ▸';
		color: #6b7280;
	}

	.fields-wrap[open] > summary::after {
		content: ' ▾';
	}

	.fields {
		padding: 0 0.9rem 0.9rem 0.9rem;
	}

	.field-group {
		border: none;
		padding: 0 0 0.8rem 0;
		margin: 0 0 0.5rem 0;
	}

	.field-group legend {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #374151;
		font-weight: 700;
		padding: 0 0 0.4rem 0;
	}

	.fields-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.7rem 0.95rem;
	}

	.fields-grid label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.2rem;
	}

	.fields-grid label.readonly span {
		color: #6b7280;
	}

	.fields-grid label span {
		color: #374151;
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.fields-grid input,
	.fields-grid textarea {
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 0.45rem 0.55rem;
		font: inherit;
	}

	.fields-grid input[disabled],
	.fields-grid input[readonly] {
		background: #f3f4f6;
		color: #374151;
		cursor: not-allowed;
	}

	.help {
		color: #6b7280;
		font-size: 0.7rem;
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	/* WorkDrive */

	.workdrive {
		display: flex;
		justify-content: flex-start;
	}

	.wd-link {
		display: inline-block;
		padding: 0.5rem 0.85rem;
		border-radius: 6px;
		background: #0ea5e9;
		color: #fff;
		text-decoration: none;
		font-weight: 600;
	}

	.wd-link:hover {
		background: #0284c7;
	}

	.muted {
		color: #6b7280;
		margin: 0;
	}

	.error {
		color: #b91c1c;
	}

	.success {
		color: #047857;
	}

	@media (max-width: 720px) {
		.header {
			flex-direction: column;
		}
		.chevron {
			align-self: flex-end;
		}
		.latest-time {
			align-items: flex-start;
		}
	}
</style>
