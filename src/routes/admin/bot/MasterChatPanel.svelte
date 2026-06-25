<script lang="ts">
	type Msg = { role: 'user' | 'assistant'; content: string };

	let messages = $state<Msg[]>([]);
	let input = $state('');
	let busy = $state(false);
	let error = $state('');

	// Cross-project starter questions, phrased to route to the right source and
	// map to data we sync (scheduling, money, project status, scope/contracts).
	const MASTER_PROMPTS = [
		'Who is working across all jobs this week?',
		"Draft next week's crew schedule from open tasks and our crew.",
		'What is outstanding to invoice or collect across all projects?',
		'Which active projects are behind or waiting on us?',
		'Which projects have contracts still unsigned?'
	];

	async function send(preset?: string) {
		const text = (preset ?? input).trim();
		if (!text || busy) return;
		error = '';
		const next: Msg[] = [...messages, { role: 'user', content: text }];
		messages = next;
		if (!preset) input = '';
		busy = true;
		try {
			const res = await fetch('/api/admin/bot/master-chat', {
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

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="master">
	<div class="messages">
		{#if messages.length === 0}
			<div class="empty">
				Ask anything across <strong>all deals</strong> — or start with one of these:
				<div class="quick-prompts">
					{#each MASTER_PROMPTS as q (q)}
						<button type="button" class="quick" onclick={() => send(q)} disabled={busy}>
							{q}
						</button>
					{/each}
				</div>
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
			placeholder="Ask across all deals… (Enter to send, Shift+Enter for newline)"
			disabled={busy}
		></textarea>
		<button onclick={() => send()} disabled={busy || !input.trim()}>Send</button>
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

	.quick-prompts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		justify-content: center;
		margin-top: 0.9rem;
	}

	.quick {
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 9999px;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
		color: #111827;
		cursor: pointer;
		align-self: auto;
		font-weight: 400;
	}

	.quick:hover:not(:disabled) {
		background: #e5e7eb;
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

	button {
		align-self: flex-end;
		padding: 0.55rem 1.1rem;
		border: none;
		border-radius: 0.5rem;
		background: #111827;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
