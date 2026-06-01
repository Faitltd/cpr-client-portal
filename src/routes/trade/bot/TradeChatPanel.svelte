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

	const QUICK_PROMPTS = [
		'What is the project address and access info?',
		'What is the scope of work for this project?',
		'What documents are in the project folder?',
		'Summarize the Project Development Agreement.',
		'Who is the primary contact and how do I reach them?'
	];

	function resetThread() {
		messages = [];
		threadId = crypto.randomUUID();
		error = '';
	}

	$effect(() => {
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

		messages = [...messages, { role: 'assistant', content: '' }];
		const assistantIndex = messages.length - 1;

		try {
			const res = await fetch('/api/trade/bot/chat', {
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
			if (messages[assistantIndex] && messages[assistantIndex].content === '') {
				messages = messages.slice(0, assistantIndex);
			}
		} finally {
			busy = false;
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
		<button class="reset-btn" type="button" onclick={resetThread} disabled={busy}>
			New conversation
		</button>
	</div>

	<div class="messages" bind:this={scrollerEl}>
		{#if messages.length === 0}
			<div class="welcome">
				<p>Ask about this project's scope, address, access info, or documents.</p>
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
				<div class="bubble-body">
					{msg.content || (busy && i === messages.length - 1 ? '…' : '')}
				</div>
			</div>
		{/each}

		{#if error}
			<div class="error">{error}</div>
		{/if}
	</div>

	<div class="composer">
		<textarea
			rows="2"
			placeholder="Ask about scope, address, access, or project documents…"
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
	.reset-btn {
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid #d1d5db;
		border-radius: 0.4rem;
		background: #ffffff;
		cursor: pointer;
	}
	.reset-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
