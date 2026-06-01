import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/db';
import { SYSTEM_PROMPT } from './prompts';
import { getDealContext, renderDealContextBlock } from './deal-context';
import { retrieveRelevant, renderRetrievedContextBlock, type RetrievedChunk } from './retrieve';

const ALL_SOURCES = [
	'zoho_mail',
	'zoho_cliq_internal',
	'zoho_cliq_external',
	'zoho_books_invoice',
	'zoho_books_estimate',
	'zoho_books_payment',
	'workdrive_pdf',
	'workdrive_docx',
	'transcript'
] as const;

function buildSourcesSearchedBlock(retrieved: RetrievedChunk[]): string {
	const bySource = new Map<string, RetrievedChunk[]>();
	for (const c of retrieved) {
		const list = bySource.get(c.source) ?? [];
		list.push(c);
		bySource.set(c.source, list);
	}
	const lines: string[] = [];
	for (const source of ALL_SOURCES) {
		const chunks = bySource.get(source) ?? [];
		if (chunks.length === 0) {
			lines.push(`- ${source}: 0 entries (nothing matched this question)`);
			continue;
		}
		const dates = chunks
			.map((c) => c.occurred_at)
			.filter((d): d is string => Boolean(d))
			.sort();
		const earliest = dates[0]?.slice(0, 10) ?? 'unknown';
		const latest = dates[dates.length - 1]?.slice(0, 10) ?? 'unknown';
		const range = earliest === latest ? earliest : `${earliest} to ${latest}`;
		const sampleSubjects = chunks
			.map((c) => c.subject)
			.filter((s): s is string => Boolean(s))
			.slice(0, 2)
			.map((s) => `"${s.slice(0, 60)}"`)
			.join(', ');
		const sampleNote = sampleSubjects ? `; sample subjects: ${sampleSubjects}` : '';
		lines.push(`- ${source}: ${chunks.length} entries (${range})${sampleNote}`);
	}
	// Include any source that came back but isn't in ALL_SOURCES (defensive)
	for (const [source, chunks] of bySource) {
		if ((ALL_SOURCES as readonly string[]).includes(source)) continue;
		lines.push(`- ${source}: ${chunks.length} entries`);
	}
	return lines.join('\n');
}

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
	/** Restrict retrieval to these sources. Null = no filter. */
	allowedSources?: string[] | null;
	/** Redact financial fields from Deal context (Amount). */
	hideFinancials?: boolean;
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
		retrieveRelevant({
			dealId: opts.dealId,
			query: lastUser.content,
			k: 12,
			allowedSources: opts.allowedSources ?? null
		}).catch((err) => {
			console.warn('[bot] retrieval failed:', err);
			return [];
		})
	]);

	let dealBlock = renderDealContextBlock(ctx);
	if (opts.hideFinancials) {
		// Strip the line that exposes deal value.
		dealBlock = dealBlock
			.split('\n')
			.filter((line) => !/^\s*Amount:/i.test(line))
			.join('\n');
	}
	const retrievedBlock = renderRetrievedContextBlock(retrieved);
	const sourcesSearchedBlock = buildSourcesSearchedBlock(retrieved);

	const sourceCounts: Record<string, number> = {};
	for (const c of retrieved) sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
	console.log(
		`[bot/chat] deal=${opts.dealId} q="${lastUser.content.slice(0, 60)}" retrieved=${retrieved.length} by_source=${JSON.stringify(sourceCounts)}`
	);

	const promptParts = [
		SYSTEM_PROMPT,
		'\n# Deal context\n' + dealBlock,
		'\n# Sources searched for this question\n' + sourcesSearchedBlock
	];
	if (retrievedBlock) {
		promptParts.push('\n# Retrieved context (cite as [#N])\n' + retrievedBlock);
	} else {
		promptParts.push(
			'\n# Retrieved context\n(no entries matched the question — see "Sources searched" block above)'
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

/**
 * Non-streaming variant for the Cliq bot. Returns the full assistant reply
 * text once OpenAI finishes. Uses the same Deal context + retrieval pipeline
 * as runChat, but skips the SSE wrapping since Cliq just needs final text.
 */
export async function runChatNonStreaming(opts: RunChatOptions): Promise<string> {
	const lastUser = opts.messages.at(-1);
	if (!lastUser || lastUser.role !== 'user') {
		throw new Error('Last message must be a user turn');
	}

	const [ctx, retrieved] = await Promise.all([
		getDealContext(opts.dealId),
		retrieveRelevant({
			dealId: opts.dealId,
			query: lastUser.content,
			k: 12,
			allowedSources: opts.allowedSources ?? null
		}).catch((err) => {
			console.warn('[bot] retrieval failed:', err);
			return [];
		})
	]);

	let dealBlock = renderDealContextBlock(ctx);
	if (opts.hideFinancials) {
		// Strip the line that exposes deal value.
		dealBlock = dealBlock
			.split('\n')
			.filter((line) => !/^\s*Amount:/i.test(line))
			.join('\n');
	}
	const retrievedBlock = renderRetrievedContextBlock(retrieved);
	const sourcesSearchedBlock = buildSourcesSearchedBlock(retrieved);

	const promptParts = [
		SYSTEM_PROMPT,
		'\n# Deal context\n' + dealBlock,
		'\n# Sources searched for this question\n' + sourcesSearchedBlock
	];
	if (retrievedBlock) {
		promptParts.push('\n# Retrieved context (cite as [#N])\n' + retrievedBlock);
	} else {
		promptParts.push(
			'\n# Retrieved context\n(no entries matched the question — see "Sources searched" block above)'
		);
	}
	const systemPrompt = promptParts.join('\n');

	await ensureThread(opts, lastUser.content.slice(0, 80));
	await persistMessage(opts.threadId, 'user', lastUser.content);

	const openai = getOpenAI();
	const completion = await openai.chat.completions.create({
		model: CHAT_MODEL,
		stream: false,
		temperature: 0.2,
		messages: [
			{ role: 'system', content: systemPrompt },
			...opts.messages.map((m) => ({ role: m.role, content: m.content }))
		]
	});

	const reply = completion.choices?.[0]?.message?.content ?? '';
	await persistMessage(opts.threadId, 'assistant', reply);
	return reply;
}
