<script lang="ts">
	type Msg = { role: 'user' | 'assistant'; content: string };

	let messages = $state<Msg[]>([]);
	let input = $state('');
	let busy = $state(false);
	let error = $state('');

	let syncing = $state(false);
	let syncStatus = $state('');

	async function send() {
		const text = input.trim();
		if (!text || busy) return;
		error = '';
		const next: Msg[] = [...messages, { role: 'user', content: text }];
		messages = next;
		input = '';
		busy = true;
		try {
			const res = await fetch('/api/admin/bot/comms-chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: next })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = data?.message || 'Request failed.';
			} else {
				messages = [...next, { role: 'assistant', content: data.reply || '(no answer)' }];
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Request failed.';
		} finally {
			busy = false;
		}
	}

	async function syncEmail() {
		if (syncing) return;
		syncing = true;
		syncStatus = 'Email sync started — indexing across all active deals in the background…';
		try {
			const res = await fetch('/api/admin/bot/sync-all?detached=1', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sources: ['mail'], detached: true })
			});
			const data = await res.json().catch(() => ({}));
			syncStatus = res.ok
				? 'Email sync running in the background. Check back in a minute or two.'
				: `Email sync failed: ${data?.message || 'unknown error'}`;
		} catch (e) {
			syncStatus = `Email sync failed: ${e instanceof Error ? e.message : 'request error'}`;
		} finally {
			syncing = false;
		}
	}

	async function syncCliq() {
		if (syncing) return;
		syncing = true;
		syncStatus = 'Syncing all Cliq channels… (this can take a minute)';
		try {
			const res = await fetch('/api/admin/bot/sync-channels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || data?.ok === false) {
				syncStatus = `Cliq sync failed: ${data?.message || data?.result?.error || 'unknown error'}`;
			} else {
				const r = data.result ?? {};
				syncStatus = `Synced ${r.channelCount ?? 0} Cliq channels · ${r.inserted ?? 0} new messages indexed.`;
			}
		} catch (e) {
			syncStatus = `Cliq sync failed: ${e instanceof Error ? e.message : 'request error'}`;
		} finally {
			syncing = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="master">
	<div class="toolbar">
		<div class="tstatus">{syncStatus}</div>
		<button class="syncbtn" onclick={syncEmail} disabled={syncing}>Sync Email</button>
		<button class="syncbtn" onclick={syncCliq} disabled={syncing}>Sync Cliq</button>
	</div>
	<div class="messages">
		{#if messages.length === 0}
			<div class="empty">
				The <strong>Comms Assistant</strong> reads only <strong>email</strong> and
				<strong>Cliq messages</strong> across the whole company. Ask about a thread, a follow-up,
				who said what, or action items from a channel.
			</div>
		{/if}
		{#each messages as m}
			<div class="msg {m.role}">
				<div class="bubble">{m.content}</div>
			</div>
		{/each}
		{#if busy}
			<div class="msg assistant"><div class="bubble muted">Thinking…</div></div>
		{/if}
	</div>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="composer">
		<textarea
			bind:value={input}
			onkeydown={onKey}
			rows="2"
			placeholder="Ask across email & Cliq… (Enter to send, Shift+Enter for newline)"
			disabled={busy}
		></textarea>
		<button onclick={send} disabled={busy || !input.trim()}>Send</button>
	</div>
</div>

<style>
	.master {
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: #fff;
		display: flex;
		flex-direction: column;
		min-height: 420px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.tstatus {
		flex: 1;
		font-size: 0.82rem;
		color: #6b7280;
		min-height: 1.1rem;
	}

	.syncbtn {
		padding: 0.45rem 0.9rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		background: #f9fafb;
		color: #111827;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.syncbtn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.messages {
		flex: 1;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
	}

	.empty {
		color: #6b7280;
		text-align: center;
		padding: 2rem 1rem;
	}

	.msg {
		display: flex;
	}

	.msg.user {
		justify-content: flex-end;
	}

	.bubble {
		max-width: 80%;
		padding: 0.6rem 0.85rem;
		border-radius: 0.75rem;
		white-space: pre-wrap;
		line-height: 1.45;
		font-size: 0.92rem;
	}

	.msg.user .bubble {
		background: #111827;
		color: #fff;
		border-bottom-right-radius: 0.2rem;
	}

	.msg.assistant .bubble {
		background: #f3f4f6;
		color: #111827;
		border-bottom-left-radius: 0.2rem;
	}

	.bubble.muted {
		color: #6b7280;
	}

	.error {
		color: #b91c1c;
		padding: 0 1rem;
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid #f1f5f9;
	}

	textarea {
		flex: 1;
		resize: vertical;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		padding: 0.55rem 0.7rem;
		font: inherit;
	}

	.composer button {
		align-self: flex-end;
		padding: 0.55rem 1.1rem;
		border: none;
		border-radius: 0.5rem;
		background: #111827;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	.composer button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
