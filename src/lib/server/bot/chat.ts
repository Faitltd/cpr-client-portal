import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/db';
import { SYSTEM_PROMPT } from './prompts';
import { getDealContext, renderDealContextBlock } from './deal-context';
import { retrieveRelevant, renderRetrievedContextBlock } from './retrieve';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

const CHAT_MODEL = env.BOT_CHAT_MODEL || 'gpt-4o-mini';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
	if (openaiClient) return openaiClient;
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY not set');
	openaiClient = new OpenAI({ apiKey });
	return openaiClient;
}

export interface RunChatOptions {
	dealId: string;
	threadId: string;
	adminEmail: string;
	messages: ChatMessage[];
}

/**
 * Ensure a bot_threads row exists for this thread id. Returns the row.
 */
async function ensureThread(opts: RunChatOptions, title: string | null): Promise<void> {
	const { data: existing } = await supabase
		.from('bot_threads')
		.select('id')
		.eq('id', opts.threadId)
		.maybeSingle();

	if (existing) {
		await supabase
			.from('bot_threads')
			.update({ last_message_at: new Date().toISOString() })
			.eq('id', opts.threadId);
		return;
	}

	await supabase.from('bot_threads').insert({
		id: opts.threadId,
		deal_id: opts.dealId,
		admin_email: opts.adminEmail,
		title: title?.slice(0, 200) ?? null
	});
}

async function persistMessage(
	threadId: string,
	role: 'user' | 'assistant',
	content: string
): Promise<void> {
	await supabase.from('bot_messages').insert({
		thread_id: threadId,
		role,
		content
	});
}

/**
 * Run one chat turn. Streams the assistant response as SSE.
 * Phase 1: no tool calls. The Deal context is injected as part of the system prompt.
 */
export async function runChat(opts: RunChatOptions): Promise<ReadableStream<Uint8Array>> {
	const lastUser = opts.messages.at(-1);
	if (!lastUser || lastUser.role !== 'user') {
		throw new Error('Last message must be a user turn');
	}

	const [ctx, retrieved] = await Promise.all([
		getDealContext(opts.dealId),
		retrieveRelevant({ dealId: opts.dealId, query: lastUser.content, k: 12 }).catch((err) => {
			console.warn('[bot] retrieval failed:', err);
			return [];
		})
	]);

	const dealBlock = renderDealContextBlock(ctx);
	const retrievedBlock = renderRetrievedContextBlock(retrieved);

	const sourceCounts: Record<string, number> = {};
	for (const c of retrieved) sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
	console.log(
		`[bot/chat] deal=${opts.dealId} q="${lastUser.content.slice(0, 60)}" retrieved=${retrieved.length} by_source=${JSON.stringify(sourceCounts)}`
	);

	const promptParts = [SYSTEM_PROMPT, '\n# Deal context\n' + dealBlock];
	if (retrievedBlock) {
		promptParts.push(
			'\n# Retrieved context (cite as [#N])\n' + retrievedBlock
		);
	}
	const systemPrompt = promptParts.join('\n');

	const titleForThread = lastUser.content.slice(0, 80);
	await ensureThread(opts, titleForThread);
	await persistMessage(opts.threadId, 'user', lastUser.content);

	const openai = getOpenAI();
	const completion = await openai.chat.completions.create({
		model: CHAT_MODEL,
		stream: true,
		temperature: 0.2,
		messages: [
			{ role: 'system', content: systemPrompt },
			...opts.messages.map((m) => ({ role: m.role, content: m.content }))
		]
	});

	const encoder = new TextEncoder();
	let collected = '';
	const threadId = opts.threadId;

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const sse = (event: string, data: unknown) => {
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			};

			sse('meta', { dealId: opts.dealId, model: CHAT_MODEL });

			try {
				for await (const chunk of completion) {
					const delta = chunk.choices?.[0]?.delta?.content ?? '';
					if (delta) {
						collected += delta;
						sse('delta', { content: delta });
					}
				}
				await persistMessage(threadId, 'assistant', collected);
				sse('done', { content: collected });
			} catch (err) {
				const message = err instanceof Error ? err.message : 'unknown error';
				sse('error', { message });
			} finally {
				controller.close();
			}
		}
	});
}
