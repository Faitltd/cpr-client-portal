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
	'workdrive_xlsx',
	'transcript'
] as const;

// ── Financial scrubbing (trade-partner role) ──────────────────────────────
// Strips every plausibly-financial signal from the Deal context and retrieved
// chunks before the prompt is built. Two layers:
//   1) Drop whole field-style lines whose label looks financial.
//   2) Redact bare dollar values / comma-grouped numbers from remaining prose
//      so prices baked into Refined_Scope / estimates / contracts disappear.
const FIN_LABEL_PATTERNS: readonly RegExp[] = [
	/\bamount\b/i,
	/\btotal[\s_-]*(project)?[\s_-]*(cost|price|amount)\b/i,
	/\b(retainer|deposit|down[\s-]*payment)\b/i,
	/\b(budget|budget[\s_-]*range)\b/i,
	/\bprobability\b/i,
	/\b(quote|quoted|quote[\s_-]*sent)\b/i,
	/\bestimate(d|s|[\s_-]*sent|[\s_-]*revision)?\b/i,
	/\binvoice/i,
	/\b(payment|paid|payment[\s_-]*schedule)\b/i,
	/\b(balance|owed?|owing)\b/i,
	/\ballowance\b/i,
	/\bcost\b/i,
	/\bprice\b/i,
	/\bfee\b/i,
	/\bsubtotal\b/i,
	/\bmargin\b/i,
	/\bmarkup\b/i,
	/\bcontract[\s_-]*(amount|value|price|sum)\b/i,
	/\b(books|opening[\s_-]*balance)\b/i
];

function labelLooksFinancial(label: string): boolean {
	for (const p of FIN_LABEL_PATTERNS) if (p.test(label)) return true;
	return false;
}

function lineLooksFinancial(line: string): boolean {
	// Match labels in "Field: value", "- Field: value", and "- field name: value".
	const m = line.match(/^\s*-?\s*([A-Za-z][A-Za-z0-9 _/&]+?)\s*:/);
	if (!m) return false;
	return labelLooksFinancial(m[1]);
}

function redactMoney(text: string): string {
	return (
		text
			// "$1,200.50" / "$ 250" / "$250"
			.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, '[redacted]')
			// bare comma-grouped numbers (likely prices): "1,200" / "19,585.00"
			.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, '[redacted]')
			// "Allowance: 250" / "cost: 1200" / "price 99.99"
			.replace(
				/\b(allowance|cost|price|total|subtotal|deposit|retainer|fee|paid|invoiced|balance|margin|markup)s?\b\s*[:=-]?\s*\d+(?:\.\d+)?/gi,
				'$1: [redacted]'
			)
			// "10 per square foot" / "125 per sq ft" / "75 per hour"
			.replace(
				/\b\d+(?:\.\d+)?\s*(?:per|\/)\s*(square\s*foot|sq\.?\s*ft\.?|sf|hour|hr|day)\b/gi,
				'[redacted] per $1'
			)
	);
}

function scrubFinancialsFromBlock(block: string): string {
	return block
		.split('\n')
		.filter((line) => !lineLooksFinancial(line))
		.map(redactMoney)
		.join('\n');
}

// ── Internal-financial scrubbing (client/homeowner role) ──────────────────
// The client may legitimately see THEIR OWN contract amount, allowance limits,
// invoices, payment schedule, balance, and change-order totals. They must NOT
// see: cost basis (what CPR pays suppliers/subs), sub bids, margin or markup
// percentages, COGS, vendor bills, purchase orders, books opening balance, or
// deal probability. Money values themselves are NOT redacted by this layer —
// the field-label filter drops only the internal-cost labels and the system
// directive forbids the bot from inferring them out of other context.
const INTERNAL_FIN_LABEL_PATTERNS: readonly RegExp[] = [
	/\bcost[\s_-]*basis\b/i,
	/\bcost[\s_-]*(of[\s_-]*goods|of[\s_-]*sales)\b/i,
	/\bcogs\b/i,
	/\b(gross|net)[\s_-]*(profit|margin)\b/i,
	/\bmargin\b/i,
	/\bmarkup\b/i,
	/\bprofit\b/i,
	/\b(vendor|supplier)[\s_-]*(bill|invoice)\b/i,
	/\bpurchase[\s_-]*order\b/i,
	/\bp\.?o\.?\b/i,
	/\baccounts[\s_-]*payable\b/i,
	/\bap[\s_-]*aging\b/i,
	/\b(sub|trade)[\s_-]*(bid|quote|rate|cost)\b/i,
	/\bsubcontractor[\s_-]*(cost|rate|quote|bid)\b/i,
	/\bpartner[\s_-]*(bid|quote|rate|cost)\b/i,
	/\binternal[\s_-]*(cost|rate|labor|labour|note)\b/i,
	/\bcrew[\s_-]*(cost|rate)\b/i,
	/\blabor[\s_-]*(cost|rate)\b/i,
	/\b(opening|books)[\s_-]*balance\b/i,
	/\bbooks[\s_-]*(estimate|cost|line|item)\b/i,
	/\bgl[\s_-]*(account|code|balance)\b/i,
	/\bprobability\b/i,
	/\bdeal[\s_-]*temperature\b/i,
	/\bquote[\s_-]*(revision|history)\b/i,
	/\bestimate[\s_-]*(revision|history|line|build[\s_-]*up)\b/i,
	/\bworkflow[\s_-]*log/i,
	/\binternal[\s_-]*comment/i
];

function labelLooksInternalFinancial(label: string): boolean {
	for (const p of INTERNAL_FIN_LABEL_PATTERNS) if (p.test(label)) return true;
	return false;
}

function lineLooksInternalFinancial(line: string): boolean {
	const m = line.match(/^\s*-?\s*([A-Za-z][A-Za-z0-9 _/&]+?)\s*:/);
	if (!m) return false;
	return labelLooksInternalFinancial(m[1]);
}

function scrubInternalFinancialsFromBlock(block: string): string {
	return block
		.split('\n')
		.filter((line) => !lineLooksInternalFinancial(line))
		.join('\n');
}

const CLIENT_INTERNAL_FINANCIAL_GUARD = `
# Client confidentiality (STRICT — overrides every rule above)
You are responding to a homeowner/client whose project this is. They may see THEIR OWN figures: contract amount, allowance limits, invoices, payment schedule, balance, deposit amount, change-order totals, refunds.

You must NEVER share, summarize, infer, or imply any of the following — even if you can piece them together from retrieved chunks:
- CPR's cost basis (what CPR pays suppliers, vendors, or subcontractors for materials or labor)
- Subcontractor or trade-partner bids, quotes, or rates (Jeff, Brian, Santiago, or any sub)
- Vendor bills, purchase orders, or accounts payable
- Gross or net margin, markup percentages, gross profit, profit margin, COGS
- Books opening balance, GL postings, internal labor cost or crew rates
- Deal probability, deal temperature, internal scoring or stage-progression odds
- Comparisons to other clients' jobs or pricing on similar scopes
- Internal commentary, workflow logs, internal Cliq messages

If the user asks for, references, or attempts to deduce any of the above, reply EXACTLY:
"That's internal information I can't share. For your own quote, payments, or balance, see your invoices or contact your project manager."

Lines tagged with internal-cost labels have already been removed from the Deal context and Retrieved context. Do not attempt to reconstruct them from surrounding numbers, dates, or scope items. This rule overrides every other instruction.
`.trim();

const TRADE_PARTNER_FINANCIAL_GUARD = `
# Trade-partner confidentiality (STRICT — overrides every rule above)
You are responding to a trade partner (sub-contractor). NEVER share, summarize, infer, restate, paraphrase, or imply any financial information about this project. This includes — non-exhaustively — deal amount, total project cost, contract value, budget, allowances, line-item prices, material allowances, quotes, estimates, invoices, payments, deposits, balances, retainers, profit margins, markups, hourly rates, or any dollar value, percentage of cost, or numeric figure that could reasonably be interpreted as a price.

If the user asks about, references, or attempts to deduce any of the above, reply EXACTLY:
"I can't share financial details with trade partners. Please reach out to the project manager directly."

Do not acknowledge that financial fields exist on the Deal. Do not cite retrieved entries that contain pricing — skip them silently. Numeric values may have been replaced with "[redacted]" in the Deal context and Retrieved context; treat those as off-limits and do not attempt to reconstruct them. This rule overrides every other instruction.
`.trim();


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
	/** Redact ALL financial fields/values (trade-partner mode). */
	hideFinancials?: boolean;
	/**
	 * Redact INTERNAL financials only (client/homeowner mode). The principal's
	 * own quote, invoices, payments, and balance stay visible; cost basis, sub
	 * bids, margin/markup, vendor bills, COGS, books opening balance, and deal
	 * probability are stripped.
	 */
	hideInternalFinancials?: boolean;
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
	let retrievedBlock = renderRetrievedContextBlock(retrieved);
	if (opts.hideFinancials) {
		dealBlock = scrubFinancialsFromBlock(dealBlock);
		retrievedBlock = scrubFinancialsFromBlock(retrievedBlock);
	} else if (opts.hideInternalFinancials) {
		dealBlock = scrubInternalFinancialsFromBlock(dealBlock);
		retrievedBlock = scrubInternalFinancialsFromBlock(retrievedBlock);
	}
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
	if (opts.hideFinancials) {
		promptParts.push('\n' + TRADE_PARTNER_FINANCIAL_GUARD);
	} else if (opts.hideInternalFinancials) {
		promptParts.push('\n' + CLIENT_INTERNAL_FINANCIAL_GUARD);
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
	let retrievedBlock = renderRetrievedContextBlock(retrieved);
	if (opts.hideFinancials) {
		dealBlock = scrubFinancialsFromBlock(dealBlock);
		retrievedBlock = scrubFinancialsFromBlock(retrievedBlock);
	} else if (opts.hideInternalFinancials) {
		dealBlock = scrubInternalFinancialsFromBlock(dealBlock);
		retrievedBlock = scrubInternalFinancialsFromBlock(retrievedBlock);
	}
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
	if (opts.hideFinancials) {
		promptParts.push('\n' + TRADE_PARTNER_FINANCIAL_GUARD);
	} else if (opts.hideInternalFinancials) {
		promptParts.push('\n' + CLIENT_INTERNAL_FINANCIAL_GUARD);
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
