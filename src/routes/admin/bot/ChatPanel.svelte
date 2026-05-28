<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		dealId: string;
		dealLabel?: string;
	}

	let { dealId, dealLabel = '' }: Props = $props();

	interface Message {
		role: 'user' | 'assistant';
		content: string;
	}

	let messages = $state<Message[]>([]);
	let input = $state('');
	let busy = $state(false);
	let error = $state('');
	let threadId = $state(crypto.randomUUID());
	let scrollerEl: HTMLDivElement | undefined = $state();
	let syncing = $state(false);
	let syncStatus = $state('');
	let workdriveFolderOverride = $state('');

	const QUICK_PROMPTS = [
		'What is the project address?',
		'Who is the primary contact and how do I reach them?',
		'What stage is this deal in and what is the closing date?',
		'Draft a short check-in email to the client.',
		'Suggest 3 meeting times next week for a site visit.'
	];

	function resetThread() {
		messages = [];
		threadId = crypto.randomUUID();
		error = '';
	}

	$effect(() => {
		// Whenever the Deal changes, start a fresh conversation.
		dealId;
		resetThread();
	});

	async function scrollToBottom() {
		await tick();
		if (scrollerEl) scrollerEl.scrollTop = scrollerEl.scrollHeight;
	}

	async function send(text: string) {
		const trimmed = text.trim();
		if (!trimmed || busy || !dealId) return;

		error = '';
		busy = true;
		messages = [...messages, { role: 'user', content: trimmed }];
		input = '';
		await scrollToBottom();

		// Optimistic assistant placeholder
		messages = [...messages, { role: 'assistant', content: '' }];
		const assistantIndex = messages.length - 1;

		try {
			const res = await fetch('/api/admin/bot/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dealId,
					threadId,
					messages: messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
				})
			});

			if (!res.ok || !res.body) {
				const errBody = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
				throw new Error(errBody.message || `HTTP ${res.status}`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const events = buffer.split('\n\n');
				buffer = events.pop() ?? '';

				for (const ev of events) {
					const lines = ev.split('\n');
					let eventName = 'message';
					let dataRaw = '';
					for (const line of lines) {
						if (line.startsWith('event:')) eventName = line.slice(6).trim();
						else if (line.startsWith('data:')) dataRaw += line.slice(5).trim();
					}
					if (!dataRaw) continue;
					let payload: any;
					try {
						payload = JSON.parse(dataRaw);
					} catch {
						continue;
					}

					if (eventName === 'delta' && typeof payload.content === 'string') {
						const updated = [...messages];
						updated[assistantIndex] = {
							role: 'assistant',
							content: updated[assistantIndex].content + payload.content
						};
						messages = updated;
						await scrollToBottom();
					} else if (eventName === 'error') {
						throw new Error(payload.message || 'Stream error');
					}
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Chat failed';
			// remove empty assistant placeholder
			if (messages[assistantIndex] && messages[assistantIndex].content === '') {
				messages = messages.slice(0, assistantIndex);
			}
		} finally {
			busy = false;
		}
	}

	function formatCliqResult(r: any): string {
		if (!r) return 'Cliq: skipped';
		const i = r.internal ?? {};
		const e = r.external ?? {};
		return (
			`Cliq internal +${i.inserted ?? 0}/${i.skipped ?? 0}` +
			(i.error ? ` (${i.error})` : '') +
			` · Cliq external +${e.inserted ?? 0}/${e.skipped ?? 0}` +
			(e.error ? ` (${e.error})` : '')
		);
	}

	function formatBooksResult(r: any): string {
		if (!r) return 'Books: skipped';
		if (r.error) return `Books: ${r.error}`;
		const inv = r.invoices ?? {};
		const est = r.estimates ?? {};
		const pay = r.payments ?? {};
		return (
			`Books invoices +${inv.inserted ?? 0}/${inv.skipped ?? 0}` +
			(inv.error ? ` (${inv.error})` : '') +
			` · estimates +${est.inserted ?? 0}/${est.skipped ?? 0}` +
			(est.error ? ` (${est.error})` : '') +
			` · payments +${pay.inserted ?? 0}/${pay.skipped ?? 0}` +
			(pay.error ? ` (${pay.error})` : '')
		);
	}

	function formatCrmEmailResult(r: any): string {
		if (!r) return 'CRM emails: skipped';
		if (r.error) return `CRM emails: ${r.error}`;
		return `CRM emails +${r.inserted ?? 0}/${r.skipped ?? 0}`;
	}

	function formatWorkDriveResult(r: any): string {
		if (!r) return 'WorkDrive: skipped';
		if (r.error) return `WorkDrive: ${r.error}`;
		const failed = r.failed ?? 0;
		const tail = failed > 0 ? ` · ${failed} failed` : '';
		return `WorkDrive +${r.inserted ?? 0}/${r.skipped ?? 0}${tail}`;
	}

	function formatMailResult(r: any): string {
		if (!r) return 'Mail: skipped';
		if (r.error) return `Mail: ${r.error}`;
		const accts = Array.isArray(r.accounts) ? r.accounts : [];
		if (accts.length === 0) return 'Mail: no accounts';
		const totals = accts.reduce(
			(acc: any, a: any) => ({
				ins: acc.ins + (a.inserted ?? 0),
				skp: acc.skp + (a.skipped ?? 0),
				errs: acc.errs + (a.error ? 1 : 0)
			}),
			{ ins: 0, skp: 0, errs: 0 }
		);
		const scopeTag = r.scope === 'org' ? 'org-wide' : 'personal only';
		const note = r.scopeNote ? ` — ${r.scopeNote}` : '';
		const perMailbox = accts
			.filter((a: any) => (a.inserted ?? 0) > 0 || a.error)
			.map((a: any) => {
				if (a.error) return `${a.mailbox}: ${a.error}`;
				return `${a.mailbox}:${a.inserted}`;
			})
			.join(', ');
		const search = r.contactEmail
			? ` · matched on: ${r.contactEmail}`
			: ' · NO contact email on Deal';
		return `Mail (${scopeTag}) +${totals.ins}/${totals.skp}${search}${perMailbox ? ` · [${perMailbox}]` : ''}${totals.errs ? ` · ${totals.errs} error(s)` : ''}${note}`;
	}

	async function runSync(
		source: 'cliq' | 'books' | 'mail' | 'crm_email' | 'workdrive' | 'all'
	) {
		if (syncing || !dealId) return;
		syncing = true;
		const label =
			source === 'all' ? 'Syncing all sources…' : `Syncing ${source}…`;
		syncStatus = label;
		try {
			const payload: any = { dealId, source };
			if ((source === 'workdrive' || source === 'all') && workdriveFolderOverride.trim()) {
				payload.folderId = workdriveFolderOverride.trim();
			}
			const res = await fetch('/api/admin/bot/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
			const r = json.result ?? {};
			const parts: string[] = [];
			if (source === 'cliq' || source === 'all') parts.push(formatCliqResult(r.cliq));
			if (source === 'books' || source === 'all') parts.push(formatBooksResult(r.books));
			if (source === 'mail' || source === 'all') parts.push(formatMailResult(r.mail));
			if (source === 'crm_email' || source === 'all')
				parts.push(formatCrmEmailResult(r.crm_email));
			if (source === 'workdrive' || source === 'all')
				parts.push(formatWorkDriveResult(r.workdrive));
			if (json.errors && json.errors.length) parts.push(`Errors: ${json.errors.join('; ')}`);
			syncStatus = parts.join(' · ');
		} catch (err) {
			syncStatus = `Sync failed: ${err instanceof Error ? err.message : 'unknown'}`;
		} finally {
			syncing = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send(input);
		}
	}
</script>

<div class="panel">
	<div class="panel-head">
		<div class="deal-pill">
			<span class="dot"></span>
			<span class="deal-name">{dealLabel || dealId}</span>
		</div>
		<div class="head-actions">
			<div class="sync-group" title="Pull latest data for this Deal">
				<button
					class="sync-btn sync-primary"
					type="button"
					onclick={() => runSync('all')}
					disabled={syncing || busy}
				>
					{syncing ? 'Syncing…' : 'Sync All'}
				</button>
				<button class="sync-btn" type="button" onclick={() => runSync('cliq')} disabled={syncing || busy}>
					Cliq
				</button>
				<button class="sync-btn" type="button" onclick={() => runSync('mail')} disabled={syncing || busy}>
					Mail
				</button>
				<button class="sync-btn" type="button" onclick={() => runSync('crm_email')} disabled={syncing || busy}>
					CRM Emails
				</button>
				<button class="sync-btn" type="button" onclick={() => runSync('books')} disabled={syncing || busy}>
					Books
				</button>
				<button class="sync-btn" type="button" onclick={() => runSync('workdrive')} disabled={syncing || busy}>
					WorkDrive
				</button>
				<input
					class="wd-input"
					type="text"
					placeholder="WD folder id override"
					bind:value={workdriveFolderOverride}
					title="Optional: paste a WorkDrive folder id to use instead of the Deal's Client_Portal_Folder field"
				/>
			</div>
			<button class="reset-btn" type="button" onclick={resetThread} disabled={busy}>
				New conversation
			</button>
		</div>
	</div>

	{#if syncStatus}
		<div class="sync-status">{syncStatus}</div>
	{/if}

	<div class="messages" bind:this={scrollerEl}>
		{#if messages.length === 0}
			<div class="welcome">
				<p>Ask anything about this Deal. Try one of these:</p>
				<div class="quick-prompts">
					{#each QUICK_PROMPTS as q (q)}
						<button type="button" class="quick" onclick={() => send(q)} disabled={busy}>
							{q}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#each messages as msg, i (i)}
			<div class="bubble bubble-{msg.role}">
				<div class="bubble-role">{msg.role === 'user' ? 'You' : 'Bot'}</div>
				<div class="bubble-body">{msg.content || (busy && i === messages.length - 1 ? '…' : '')}</div>
			</div>
		{/each}

		{#if error}
			<div class="error">{error}</div>
		{/if}
	</div>

	<div class="composer">
		<textarea
			rows="2"
			placeholder="Ask about address, contact, stage, draft an email, suggest meeting times…"
			bind:value={input}
			onkeydown={onKey}
			disabled={busy}
		></textarea>
		<button type="button" onclick={() => send(input)} disabled={busy || !input.trim()}>
			{busy ? 'Thinking…' : 'Send'}
		</button>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 70vh;
		min-height: 480px;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: #ffffff;
		overflow: hidden;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.deal-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #111827;
		font-weight: 600;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #10b981;
	}

	.head-actions {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}

	.reset-btn,
	.sync-btn {
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid #d1d5db;
		border-radius: 0.4rem;
		background: #ffffff;
		cursor: pointer;
	}

	.sync-btn {
		background: #ffffff;
	}

	.sync-group {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.2rem;
		border-radius: 0.5rem;
		background: #f3f4f6;
	}

	.sync-primary {
		background: #2563eb;
		border-color: #2563eb;
		color: #ffffff;
		font-weight: 700;
	}

	.wd-input {
		font-size: 0.78rem;
		padding: 0.25rem 0.45rem;
		border: 1px solid #d1d5db;
		border-radius: 0.35rem;
		background: #ffffff;
		width: 220px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.reset-btn:disabled,
	.sync-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sync-status {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #e5e7eb;
		background: #f0f9ff;
		color: #075985;
		font-size: 0.8rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: #ffffff;
	}

	.welcome {
		color: #6b7280;
		font-size: 0.95rem;
	}

	.quick-prompts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.quick {
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 9999px;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
		cursor: pointer;
		color: #111827;
	}

	.quick:hover:not(:disabled) {
		background: #e5e7eb;
	}

	.bubble {
		max-width: 80%;
		padding: 0.6rem 0.85rem;
		border-radius: 0.75rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-wrap: break-word;
		font-size: 0.95rem;
	}

	.bubble-user {
		align-self: flex-end;
		background: #2563eb;
		color: #ffffff;
	}

	.bubble-assistant {
		align-self: flex-start;
		background: #f3f4f6;
		color: #111827;
	}

	.bubble-role {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
		margin-bottom: 0.2rem;
	}

	.error {
		align-self: stretch;
		padding: 0.6rem 0.85rem;
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #991b1b;
		border-radius: 0.5rem;
		font-size: 0.9rem;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.composer textarea {
		flex: 1;
		resize: vertical;
		min-height: 2.5rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		font: inherit;
		font-size: 0.95rem;
	}

	.composer button {
		align-self: flex-end;
		padding: 0.55rem 1.1rem;
		background: #111827;
		color: #ffffff;
		border: none;
		border-radius: 0.5rem;
		font-weight: 600;
		cursor: pointer;
	}

	.composer button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
