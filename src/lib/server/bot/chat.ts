import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/db';
import { SYSTEM_PROMPT } from './prompts';
import { getDealContext, renderDealContextBlock } from './deal-context';
import {
	retrieveRelevant,
	retrieveAllDeals,
	renderRetrievedContextBlock,
	type RetrievedChunk,
	type CrossDealChunk
} from './retrieve';

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
	'zoho_projects_task',
	'zoho_projects_activity',
	'zoho_sign_request',
	'zoho_calendar',
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

/**
 * Build a retrieval query that carries conversational context. The last user
 * message gets the heaviest weight; the two prior user turns are appended so
 * pronoun-y follow-ups ("when was it ordered?", "what color?", "and the
 * other one?") still match the right document even though the entity name
 * isn't in the latest message.
 *
 * Capped at ~600 chars so we don't overwhelm the embedding model with a
 * full chat scrollback.
 */
function buildRetrievalQuery(messages: ChatMessage[]): string {
	const userTurns = messages.filter((m) => m.role === 'user').slice(-3);
	if (userTurns.length === 0) return '';
	const latest = userTurns[userTurns.length - 1].content.trim();
	const prior = userTurns.slice(0, -1).map((m) => m.content.trim()).filter(Boolean);
	if (prior.length === 0) return latest;
	const composed = `${latest}\n\nEarlier in this conversation:\n${prior.join('\n')}`;
	return composed.length > 600 ? composed.slice(0, 600) : composed;
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
	/\b(vendor|supplier)[\s_-]*(bill|invoice|rate|cost|price)\b/i,
	/\bpurchase[\s_-]*order\b/i,
	/\bp\.?o\.?\b/i,
	/\baccounts[\s_-]*payable\b/i,
	/\bap[\s_-]*aging\b/i,
	/\b(sub|trade)[\s_-]*(bid|quote|rate|cost)\b/i,
	/\bsubcontractor[\s_-]*(cost|rate|quote|bid)\b/i,
	/\bpartner[\s_-]*(bid|quote|rate|cost)\b/i,
	/\binternal[\s_-]*(cost|rate|labor|labour|note|price)\b/i,
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
	/\binternal[\s_-]*comment/i,
	// Pre-markup / wholesale / raw cost terminology
	/\b(raw|net|wholesale|trade|dealer|distributor)[\s_-]*(cost|price|rate)\b/i,
	/\bpre[\s_-]*markup\b/i,
	/\bpre[\s_-]*tax[\s_-]*cost\b/i,
	/\bmaterial[\s_-]*(cost|basis|net)\b/i,
	/\b(true|actual|underlying|base)[\s_-]*cost\b/i,
	/\bcost[\s_-]*(plus|to[\s_-]*us|to[\s_-]*cpr)\b/i,
	/\bdiscount[\s_-]*(received|from[\s_-]*vendor)\b/i,
	/\btrade[\s_-]*discount\b/i,
	/\b(supplier|vendor)[\s_-]*discount\b/i,
	/\bnet[\s_-]*\d/i, // "Net 30" / "Net30" style payment terms shouldn't leak
	/\bbid[\s_-]*sheet\b/i
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
You are responding to a homeowner/client whose project this is. They may see THEIR OWN customer-facing figures: contract amount, allowance limits, invoices, payment schedule, balance, deposit amount, change-order totals (as billed to them), refunds.

You must NEVER share, summarize, infer, imply, or back-calculate any of the following — even if you can piece them together from retrieved chunks, even if the user asks indirectly:
- CPR's cost basis or pre-markup pricing (what CPR pays suppliers, vendors, or subcontractors for materials or labor, before any margin)
- Wholesale / trade / dealer / distributor / net / raw / true / actual / underlying / base cost on any line item
- Material cost basis, "cost to us", "cost to CPR", "cost plus" pricing breakdowns
- Subcontractor or trade-partner bids, quotes, or rates (Jeff, Brian, Santiago, or any sub) — including hourly rates and lump-sum bids
- Vendor bills, supplier invoices, supplier rates, purchase orders, accounts payable
- Trade discounts, vendor discounts, or distributor discounts received by CPR
- Gross or net margin, markup percentages, markup dollars, gross profit, profit margin, COGS
- Books opening balance, GL postings, internal labor cost or crew rates
- Deal probability, deal temperature, internal scoring or stage-progression odds
- Comparisons to other clients' jobs or pricing on similar scopes
- Internal commentary, workflow logs, internal Cliq messages
- Bid sheets, internal estimate build-ups, line-item cost-plus calculations

**Back-calculation is also forbidden.** If two numbers retrieved would allow the user to deduce a markup percentage, supplier cost, or margin (e.g. an invoice subtotal vs. a hidden estimate cost), DO NOT perform that math, even if asked nicely or framed as "just curious" or "for budgeting." Treat any request that would reveal a pre-markup, wholesale, or cost-plus figure the same as a direct request for that figure.

If the user asks for, references, or attempts to deduce any of the above, reply EXACTLY:
"That's internal information I can't share. For your own quote, payments, or balance, see your invoices or contact your project manager."

Lines tagged with internal-cost labels have already been removed from the Deal context and Retrieved context. Do not attempt to reconstruct them from surrounding numbers, dates, scope items, or by comparing two visible figures. Only quote customer-facing numbers that appear on the client's own invoices, contract, or change orders. This rule overrides every other instruction.
`.trim();

const TRADE_PARTNER_FINANCIAL_GUARD = `
# Trade-partner confidentiality (STRICT — overrides every rule above)
You are responding to a trade partner (sub-contractor). NEVER share, summarize, infer, restate, paraphrase, or imply any financial information about this project. This includes — non-exhaustively — deal amount, total project cost, contract value, budget, allowances, line-item prices, material allowances, quotes, estimates, invoices, payments, deposits, balances, retainers, profit margins, markups, hourly rates, or any dollar value, percentage of cost, or numeric figure that could reasonably be interpreted as a price.

If the user asks about, references, or attempts to deduce any of the above, reply EXACTLY:
"I can't share financial details with trade partners. Please reach out to the project manager directly."

Do not acknowledge that financial fields exist on the Deal. Do not cite retrieved entries that contain pricing — skip them silently. Numeric values may have been replaced with "[redacted]" in the Deal context and Retrieved context; treat those as off-limits and do not attempt to reconstruct them. This rule overrides every other instruction.
`.trim();


/**
 * Complete Books picture for the Deal, independent of similarity retrieval.
 * Top-k retrieval only surfaces a few invoice chunks, so questions like
 * "what's the total invoiced / outstanding?" were answered from a partial
 * view. This loads EVERY ingested Books record (invoices, estimates,
 * payments) for the deal — they're small rendered summaries — so the model
 * can total them. Returns null when the deal has no Books records.
 */
const BOOKS_BLOCK_MAX_CHARS = 14000;

async function buildBooksFinancialBlock(dealId: string): Promise<string | null> {
	const { data, error } = await supabase
		.from('bot_documents')
		.select('source, subject, body, occurred_at')
		.eq('deal_id', dealId)
		.in('source', ['zoho_books_invoice', 'zoho_books_estimate', 'zoho_books_payment'])
		.order('occurred_at', { ascending: true });

	if (error) {
		console.warn('[bot/chat] books financial block fetch failed:', error.message);
		return null;
	}
	if (!data || data.length === 0) return null;

	const lines: string[] = [
		`All Zoho Books records for this Deal (${data.length} total). This list is COMPLETE — use it for any question about totals, amounts invoiced, payments received, or outstanding balance. Sum these records rather than guessing.`,
		''
	];
	let used = 0;
	for (const doc of data) {
		// First 3 lines of the rendered record carry number/status/date/total/
		// balance — enough to aggregate. Line-item detail still arrives via
		// the Retrieved context when relevant.
		const summary = String(doc.body ?? '')
			.split('\n')
			.slice(0, 3)
			.join(' · ');
		const entry = `- [${doc.source}] ${doc.occurred_at?.slice(0, 10) ?? ''} ${summary}`;
		if (used + entry.length > BOOKS_BLOCK_MAX_CHARS) {
			lines.push(`… (${data.length} records total; list truncated)`);
			break;
		}
		lines.push(entry);
		used += entry.length;
	}
	return lines.join('\n');
}

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
	/**
	 * If set, only WorkDrive chunks whose document's top_folder is in this list
	 * are returned. Used to gate trade partners to "Designs" only.
	 */
	allowedTopFolders?: string[] | null;
	/** Regex patterns (strings) that drop WorkDrive chunks by filename. */
	blockedSubjectPatterns?: string[] | null;
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

	const retrievalQuery = buildRetrievalQuery(opts.messages);
	const [ctx, retrieved] = await Promise.all([
		getDealContext(opts.dealId),
		retrieveRelevant({
			dealId: opts.dealId,
			query: retrievalQuery || lastUser.content,
			k: 12,
			allowedSources: opts.allowedSources ?? null,
			allowedTopFolders: opts.allowedTopFolders ?? null,
			blockedSubjectPatterns: opts.blockedSubjectPatterns ?? null
		}).catch((err) => {
			console.warn('[bot] retrieval failed:', err);
			return [];
		})
	]);

	let dealBlock = renderDealContextBlock(ctx);
	let retrievedBlock = renderRetrievedContextBlock(retrieved);
	if (opts.hideFinancials) {
		dealBlock = scrubFinancialsFromBlock(dealBlock);
		if (retrievedBlock) retrievedBlock = scrubFinancialsFromBlock(retrievedBlock);
	} else if (opts.hideInternalFinancials) {
		dealBlock = scrubInternalFinancialsFromBlock(dealBlock);
		if (retrievedBlock) retrievedBlock = scrubInternalFinancialsFromBlock(retrievedBlock);
	}
	const sourcesSearchedBlock = buildSourcesSearchedBlock(retrieved);

	// Complete Books financial picture — omitted entirely for trade partners
	// (hideFinancials); internal-cost lines scrubbed for clients.
	let booksBlock: string | null = null;
	if (!opts.hideFinancials) {
		booksBlock = await buildBooksFinancialBlock(opts.dealId);
		if (booksBlock && opts.hideInternalFinancials) {
			booksBlock = scrubInternalFinancialsFromBlock(booksBlock);
		}
	}

	const sourceCounts: Record<string, number> = {};
	for (const c of retrieved) sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
	console.log(
		`[bot/chat] deal=${opts.dealId} q="${lastUser.content.slice(0, 60)}" retrieved=${retrieved.length} by_source=${JSON.stringify(sourceCounts)}`
	);
	const top5 = retrieved
		.slice(0, 5)
		.map((c, i) => `[${i + 1}] ${c.source} ${(c.subject ?? '').slice(0, 60)}`);
	console.log(`[bot/chat] top5: ${JSON.stringify(top5)}`);

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
	if (booksBlock) {
		promptParts.push('\n# Books financial records (complete list for this Deal)\n' + booksBlock);
	}

	// Inject a literal numbered list of every WorkDrive doc retrieved (one
	// entry per unique document, with its source_url). When the user asks
	// "what documents are in the folder?" the LLM has to acknowledge each
	// row — it can't drop files like it does when it tries to summarise the
	// Retrieved context block on its own.
	const workdriveDocs = new Map<string, { subject: string; url: string | null }>();
	for (const c of retrieved) {
		if (!c.source.startsWith('workdrive_')) continue;
		if (workdriveDocs.has(c.document_id)) continue;
		workdriveDocs.set(c.document_id, {
			subject: c.subject ?? '(untitled)',
			url: c.source_url ?? null
		});
	}
	if (workdriveDocs.size > 0) {
		const inventoryLines: string[] = [];
		let i = 1;
		for (const { subject, url } of workdriveDocs.values()) {
			const link = url ? `[${subject}](${url})` : subject;
			inventoryLines.push(`${i}. ${link}`);
			i += 1;
		}
		promptParts.push(
			`\n# Full WorkDrive document inventory for this Deal (${workdriveDocs.size} files)\n` +
				`When the user asks what documents are in the folder, what files exist, the scope, or anything that requires listing the project's docs, you MUST output this complete list verbatim, in this exact order. Do not omit any line. Do not summarise. Do not pick a subset. The URL for each file is the EXACT string in parentheses — do not modify the domain, hash, or any character.\n\n` +
				inventoryLines.join('\n')
		);
	} else {
		// No WorkDrive docs accessible to this caller for this Deal. Tell the
		// LLM explicitly so it doesn't hallucinate a filename or URL from
		// chat/email references it might see elsewhere in the context.
		promptParts.push(
			`\n# Full WorkDrive document inventory for this Deal (0 files)\n` +
				`The caller has access to ZERO WorkDrive documents for this Deal. If they ask "what documents are in the folder?", "what's in my Client Portal?", "what files do we have?", or anything similar, your answer MUST be exactly: "There are no documents available to you in this folder right now." Do NOT name any file. Do NOT invent a URL. Do NOT reference contracts, agreements, PDAs, blueprints, or scopes even if they appear in chat or email chunks — those references are NOT documents you can show. If the user asks why, suggest they contact their project manager.`
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

	const retrievalQuery = buildRetrievalQuery(opts.messages);
	const [ctx, retrieved] = await Promise.all([
		getDealContext(opts.dealId),
		retrieveRelevant({
			dealId: opts.dealId,
			query: retrievalQuery || lastUser.content,
			k: 12,
			allowedSources: opts.allowedSources ?? null,
			allowedTopFolders: opts.allowedTopFolders ?? null,
			blockedSubjectPatterns: opts.blockedSubjectPatterns ?? null
		}).catch((err) => {
			console.warn('[bot] retrieval failed:', err);
			return [];
		})
	]);

	let dealBlock = renderDealContextBlock(ctx);
	let retrievedBlock = renderRetrievedContextBlock(retrieved);
	if (opts.hideFinancials) {
		dealBlock = scrubFinancialsFromBlock(dealBlock);
		if (retrievedBlock) retrievedBlock = scrubFinancialsFromBlock(retrievedBlock);
	} else if (opts.hideInternalFinancials) {
		dealBlock = scrubInternalFinancialsFromBlock(dealBlock);
		if (retrievedBlock) retrievedBlock = scrubInternalFinancialsFromBlock(retrievedBlock);
	}
	const sourcesSearchedBlock = buildSourcesSearchedBlock(retrieved);

	// Complete Books financial picture — omitted entirely for trade partners
	// (hideFinancials); internal-cost lines scrubbed for clients.
	let booksBlock: string | null = null;
	if (!opts.hideFinancials) {
		booksBlock = await buildBooksFinancialBlock(opts.dealId);
		if (booksBlock && opts.hideInternalFinancials) {
			booksBlock = scrubInternalFinancialsFromBlock(booksBlock);
		}
	}

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
	if (booksBlock) {
		promptParts.push('\n# Books financial records (complete list for this Deal)\n' + booksBlock);
	}

	// Inject a literal numbered list of every WorkDrive doc retrieved (one
	// entry per unique document, with its source_url). When the user asks
	// "what documents are in the folder?" the LLM has to acknowledge each
	// row — it can't drop files like it does when it tries to summarise the
	// Retrieved context block on its own.
	const workdriveDocs = new Map<string, { subject: string; url: string | null }>();
	for (const c of retrieved) {
		if (!c.source.startsWith('workdrive_')) continue;
		if (workdriveDocs.has(c.document_id)) continue;
		workdriveDocs.set(c.document_id, {
			subject: c.subject ?? '(untitled)',
			url: c.source_url ?? null
		});
	}
	if (workdriveDocs.size > 0) {
		const inventoryLines: string[] = [];
		let i = 1;
		for (const { subject, url } of workdriveDocs.values()) {
			const link = url ? `[${subject}](${url})` : subject;
			inventoryLines.push(`${i}. ${link}`);
			i += 1;
		}
		promptParts.push(
			`\n# Full WorkDrive document inventory for this Deal (${workdriveDocs.size} files)\n` +
				`When the user asks what documents are in the folder, what files exist, the scope, or anything that requires listing the project's docs, you MUST output this complete list verbatim, in this exact order. Do not omit any line. Do not summarise. Do not pick a subset. The URL for each file is the EXACT string in parentheses — do not modify the domain, hash, or any character.\n\n` +
				inventoryLines.join('\n')
		);
	} else {
		// No WorkDrive docs accessible to this caller for this Deal. Tell the
		// LLM explicitly so it doesn't hallucinate a filename or URL from
		// chat/email references it might see elsewhere in the context.
		promptParts.push(
			`\n# Full WorkDrive document inventory for this Deal (0 files)\n` +
				`The caller has access to ZERO WorkDrive documents for this Deal. If they ask "what documents are in the folder?", "what's in my Client Portal?", "what files do we have?", or anything similar, your answer MUST be exactly: "There are no documents available to you in this folder right now." Do NOT name any file. Do NOT invent a URL. Do NOT reference contracts, agreements, PDAs, blueprints, or scopes even if they appear in chat or email chunks — those references are NOT documents you can show. If the user asks why, suggest they contact their project manager.`
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

/**
 * Master assistant — answers across ALL deals at once. Uses cross-deal vector
 * retrieval (bot_match_chunks_all) instead of a single-deal scope, so it can
 * reason over the whole corpus. Stateless (no thread persistence): the client
 * sends the full message history each turn. Admin-only.
 */
// Communications assistant scope: email + Cliq only (deal-linked Cliq plus the
// company-wide channels ingested under sentinel deal ids).
const COMMS_SOURCES = [
	'zoho_mail',
	'zoho_cliq_internal',
	'zoho_cliq_external',
	'zoho_cliq_channel'
];

export async function runMasterChatNonStreaming(opts: {
	adminEmail: string;
	messages: ChatMessage[];
	/** 'deal' = cross-deal over everything (default); 'comms' = email + Cliq only. */
	mode?: 'deal' | 'comms';
}): Promise<string> {
	const lastUser = opts.messages.at(-1);
	if (!lastUser || lastUser.role !== 'user') {
		throw new Error('Last message must be a user turn');
	}
	const mode = opts.mode ?? 'deal';

	const retrievalQuery = buildRetrievalQuery(opts.messages);
	const retrieved = await retrieveAllDeals({
		query: retrievalQuery || lastUser.content,
		k: 18,
		includeSources: mode === 'comms' ? COMMS_SOURCES : null,
		// The deal master stays strictly deal-scoped — company-wide Cliq channels
		// belong to the Comms assistant, not here.
		excludeSources: mode === 'deal' ? ['zoho_cliq_channel'] : null
	}).catch((err) => {
		console.warn('[bot/master] retrieval failed:', err);
		return [] as CrossDealChunk[];
	});

	// Resolve project names for the deals that showed up, so the assistant can
	// attribute each fact to a named project instead of an opaque Zoho id.
	const uniqueDealIds = Array.from(
		new Set(retrieved.map((c) => c.deal_id).filter((id): id is string => Boolean(id)))
	).slice(0, 12);
	// Sentinel deal ids (e.g. "__cliq__<channelId>") are company-wide Cliq
	// channels, not real Deals — don't try to resolve them in CRM. The chunk's
	// subject already carries the "#channel" name for attribution.
	const isSentinel = (id: string) => id.startsWith('__');
	const nameEntries = await Promise.all(
		uniqueDealIds.map(async (id) => {
			if (isSentinel(id)) return [id, 'Cliq channels (company-wide)'] as const;
			try {
				const ctx = await getDealContext(id);
				return [id, ctx.name?.trim() || `Deal ${id}`] as const;
			} catch {
				return [id, `Deal ${id}`] as const;
			}
		})
	);
	const dealNames = new Map<string, string>(nameEntries);
	const labelFor = (id: string | null) =>
		id ? dealNames.get(id) ?? `Deal ${id}` : 'Unknown project';

	// Fold the project name into each chunk's subject so the existing renderer
	// shows which project a passage belongs to.
	const labeled: RetrievedChunk[] = retrieved.map((c) => ({
		...c,
		subject: `[Project: ${labelFor(c.deal_id)}] ${c.subject ?? ''}`.trim()
	}));
	const retrievedBlock = renderRetrievedContextBlock(labeled);

	const projectsOverview = uniqueDealIds.length
		? uniqueDealIds.map((id) => (isSentinel(id) ? `- ${labelFor(id)}` : `- ${labelFor(id)} (Zoho id ${id})`)).join('\n')
		: '(none)';

	const scopeBlurb =
		mode === 'comms'
			? 'You are the CPR Communications Assistant. The retrieved context below is drawn ONLY from email and Cliq messages across the whole company. Use it to answer questions about conversations, threads, who said what, follow-ups, and action items. Each passage is tagged with the project or channel it came from as "[Project: <name>]". Attribute facts to that source. If the retrieved context does not contain the answer, say so plainly instead of guessing.'
			: 'You are the CPR master assistant. The retrieved context below is pulled from ALL projects at once; each passage is tagged with the project it came from as "[Project: <name>]". Answer across projects, and ALWAYS attribute facts to the named project they came from (never leave a job unattributed). If asked which project something is for, use the project name from the tag. If the retrieved context does not contain the answer, say so plainly instead of guessing.';
	const promptParts = [
		SYSTEM_PROMPT,
		'\n# Assistant scope\n' + scopeBlurb,
		'\n# Projects referenced in this answer\n' + projectsOverview
	];
	if (retrievedBlock) {
		promptParts.push('\n# Retrieved context across all projects (cite as [#N])\n' + retrievedBlock);
	} else {
		promptParts.push('\n# Retrieved context\n(no entries matched the question)');
	}
	const systemPrompt = promptParts.join('\n');

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

	return completion.choices?.[0]?.message?.content ?? '';
}
