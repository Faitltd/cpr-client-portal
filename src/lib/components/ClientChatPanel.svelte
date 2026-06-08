<script lang="ts">
	import { tick } from 'svelte';
	import { renderMarkdown } from '$lib/markdown';

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
		'What is the current status of my project, and what is next?',
		'What has changed on my project recently?',
		'What is my remaining balance and payment history?',
		'What is the scope of work for my project?',
		'When will my materials be ordered or delivered?',
		'What documents are available in my project folder?'
	];

	function resetThread() {
		messages = [];
		threadId = crypto.randomUUID();
		error = '';
	}

	$effect(() => {
		dealId;
		resetThread();
		// Silent background refresh so the bot always reflects the latest
		// project state when the client opens their dashboard.
		if (dealId) {
			fetch('/api/client/bot/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dealId })
			}).catch(() => {
				/* ignore — silent */
			});
		}
	});

	async function scrollToBottom() {
		await tick();
		if (scrollerEl) scrollerEl.scrollTop = scrollerEl.scrollHeight;
	}

	async function send(text: string) {
		const trimmed = text.trim();
		if (!trimmed || busy || !dealId) return;
		input = '';
		error = '';

		messages = [...messages, { role: 'user', content: trimmed }];
		busy = true;
		await scrollToBottom();

		messages = [...messages, { role: 'assistant', content: '' }];
		const assistantIndex = messages.length - 1;

		try {
			const response = await fetch('/api/client/bot/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dealId,
					threadId,
					messages: messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
				})
			});

			if (!response.ok || !response.body) {
				const detail = await response.json().catch(() => null);
				error = detail?.message ?? `Chat failed (${response.status})`;
				messages = messages.slice(0, -1);
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const events = buf.split('\n\n');
				buf = events.pop() ?? '';
				for (const evt of events) {
					if (!evt.trim()) continue;
					const lines = evt.split('\n');
					let eventName = 'message';
					let dataLine = '';
					for (const line of lines) {
						if (line.startsWith('event:')) eventName = line.slice(6).trim();
						if (line.startsWith('data:')) dataLine = line.slice(5).trim();
					}
					if (!dataLine) continue;
					try {
						const payload = JSON.parse(dataLine);
						if (eventName === 'delta' && typeof payload.content === 'string') {
							const updated = [...messages];
							updated[assistantIndex] = {
								role: 'assistant',
								content: updated[assistantIndex].content + payload.content
							};
							messages = updated;
							await scrollToBottom();
						} else if (eventName === 'error') {
							error = payload?.message ?? 'Chat error';
						}
					} catch {
						/* ignore parse errors */
					}
				}
			}
			if (messages[assistantIndex] && messages[assistantIndex].content === '') {
				messages = messages.slice(0, -1);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Network error';
			messages = messages.slice(0, -1);
		} finally {
			busy = false;
			await scrollToBottom();
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
			<span class="deal-name">{dealLabel || 'My project'}</span>
		</div>
		<button class="reset-btn" type="button" onclick={resetThread} disabled={busy}>
			New conversation
		</button>
	</div>

	<div class="messages" bind:this={scrollerEl}>
		{#if messages.length === 0}
			<div class="welcome">
				<p>Ask anything about your project — status, payments, documents, what's next.</p>
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
				<div class="bubble-role">{msg.role === 'user' ? 'You' : 'CPR Bot'}</div>
				<div class="bubble-body">
					{#if msg.role === 'assistant' && msg.content}
						{@html renderMarkdown(msg.content)}
					{:else}
						{msg.content || (busy && i === messages.length - 1 ? '…' : '')}
					{/if}
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
			placeholder="Ask about your project…"
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
		gap: 0.75rem;
		background: #ffffff;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		padding: 1rem;
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.deal-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		font-size: 0.95rem;
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		background: #10b981;
		border-radius: 50%;
	}
	.reset-btn {
		font-size: 0.8rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid #d1d5db;
		background: #f9fafb;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.messages {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 520px;
		min-height: 200px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.welcome {
		text-align: left;
		color: #4b5563;
	}
	.quick-prompts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}
	.quick {
		padding: 0.3rem 0.65rem;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
		border-radius: 999px;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.bubble {
		max-width: 90%;
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
		white-space: normal;
	}
	.bubble-assistant :global(p) {
		margin: 0 0 0.5rem 0;
	}
	.bubble-assistant :global(p:last-child) {
		margin-bottom: 0;
	}
	.bubble-assistant :global(a) {
		color: #2563eb;
		text-decoration: underline;
		word-break: break-all;
	}
	.bubble-assistant :global(ul),
	.bubble-assistant :global(ol) {
		margin: 0.25rem 0 0.5rem 1.25rem;
		padding: 0;
	}
	.bubble-assistant :global(.md-table) {
		border-collapse: collapse;
		margin: 0.4rem 0;
		font-size: 0.9em;
		width: 100%;
	}
	.bubble-assistant :global(.md-table th),
	.bubble-assistant :global(.md-table td) {
		border: 1px solid #d1d5db;
		padding: 0.25rem 0.5rem;
		text-align: left;
	}
	.bubble-assistant :global(.md-table th) {
		background: #e5e7eb;
		font-weight: 600;
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
	}
	.composer {
		display: flex;
		gap: 0.5rem;
	}
	textarea {
		flex: 1;
		resize: vertical;
		padding: 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		font-family: inherit;
		font-size: 0.95rem;
	}
	.composer button {
		padding: 0.4rem 1rem;
		background: #2563eb;
		color: #ffffff;
		border: none;
		border-radius: 0.5rem;
		cursor: pointer;
		font-weight: 600;
	}
	.composer button:disabled {
		background: #9ca3af;
		cursor: not-allowed;
	}
</style>
