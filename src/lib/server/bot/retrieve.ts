import { supabase } from '$lib/server/db';
import { embed } from './embeddings';

export interface RetrievedChunk {
	chunk_id: string;
	document_id: string;
	content: string;
	source: string;
	subject: string | null;
	author: string | null;
	occurred_at: string;
	source_url: string | null;
	similarity: number;
}

const TIME_KEYWORDS: RegExp[] = [
	/\btoday\b/i,
	/\byesterday\b/i,
	/\b(this|last|past)\s+(week|day|month|hour)/i,
	/\brecent\b/i,
	/\brecently\b/i,
	/\blatest\b/i,
	/\bnewest\b/i,
	/\bcurrent\b/i,
	/\bin\s+the\s+last\s+\d+\s+(day|week|month|hour)s?/i,
	/\bnow\b/i
];

function detectTimeWindow(query: string): number | null {
	const lower = query.toLowerCase();
	if (/\btoday\b|\bnow\b/.test(lower)) return 1;
	if (/\byesterday\b/.test(lower)) return 2;
	const explicit = lower.match(/last\s+(\d+)\s+(day|week|month)s?/);
	if (explicit) {
		const n = parseInt(explicit[1], 10);
		const unit = explicit[2];
		if (Number.isFinite(n)) {
			if (unit === 'day') return n;
			if (unit === 'week') return n * 7;
			if (unit === 'month') return n * 30;
		}
	}
	if (/(this|last|past)\s+week/.test(lower)) return 7;
	if (/(this|last|past)\s+month/.test(lower)) return 30;
	for (const re of TIME_KEYWORDS) if (re.test(query)) return 14;
	return null;
}

async function fetchRecentChunks(opts: {
	dealId: string;
	days: number;
	limit: number;
	source?: string;
}): Promise<RetrievedChunk[]> {
	const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000).toISOString();
	let query = supabase
		.from('bot_documents')
		.select('id, source, subject, author, occurred_at, source_url, bot_chunks!inner(id, content)')
		.eq('deal_id', opts.dealId)
		.gte('occurred_at', cutoff)
		.order('occurred_at', { ascending: false })
		.limit(opts.limit);
	if (opts.source) query = query.eq('source', opts.source);

	const { data, error } = await query;
	if (error) {
		console.warn('[bot/retrieve] recency fetch failed:', error.message);
		return [];
	}
	const out: RetrievedChunk[] = [];
	for (const doc of data ?? []) {
		const chunks = Array.isArray(doc.bot_chunks) ? doc.bot_chunks : [];
		const firstChunk = chunks[0];
		if (!firstChunk) continue;
		out.push({
			chunk_id: firstChunk.id,
			document_id: doc.id,
			content: firstChunk.content,
			source: doc.source,
			subject: doc.subject ?? null,
			author: doc.author ?? null,
			occurred_at: doc.occurred_at,
			source_url: doc.source_url ?? null,
			similarity: 0 // recency hits don't carry a similarity score
		});
	}
	return out;
}

function mergeChunks(...lists: RetrievedChunk[][]): RetrievedChunk[] {
	const seen = new Set<string>();
	const out: RetrievedChunk[] = [];
	for (const list of lists) {
		for (const c of list) {
			if (seen.has(c.chunk_id)) continue;
			seen.add(c.chunk_id);
			out.push(c);
		}
	}
	return out;
}

/**
 * Two-pass diversification:
 *  1. Take the top `perSource` chunks from each source (in similarity order)
 *  2. Fill the rest of `cap` with the next-best overall chunks regardless of source
 *
 * Prevents one chatty source (Cliq) from drowning out smaller-but-relevant
 * sources (Books, WorkDrive, Mail).
 */
function diversifyBySource(
	chunks: RetrievedChunk[],
	cap: number,
	perSource: number
): RetrievedChunk[] {
	const bySource = new Map<string, RetrievedChunk[]>();
	for (const c of chunks) {
		const list = bySource.get(c.source) ?? [];
		list.push(c);
		bySource.set(c.source, list);
	}
	const picked: RetrievedChunk[] = [];
	const seen = new Set<string>();
	for (const list of bySource.values()) {
		for (const c of list.slice(0, perSource)) {
			if (seen.has(c.chunk_id)) continue;
			seen.add(c.chunk_id);
			picked.push(c);
		}
	}
	// Fill remaining slots with the next-best overall (regardless of source).
	for (const c of chunks) {
		if (picked.length >= cap) break;
		if (seen.has(c.chunk_id)) continue;
		seen.add(c.chunk_id);
		picked.push(c);
	}
	return picked.slice(0, cap);
}

/**
 * Hybrid retrieval. Always runs vector search. If the question has time
 * keywords ("last week", "today", "recent"), ALSO pulls the most recent
 * documents within that window so time-bounded questions don't depend on
 * semantic similarity ranking the right items.
 */
export async function retrieveRelevant(opts: {
	dealId: string;
	query: string;
	k?: number;
	/** If set, drop any chunk whose `source` is not in this list. */
	allowedSources?: string[] | null;
}): Promise<RetrievedChunk[]> {
	const query = opts.query.trim();
	if (!query) return [];

	const k = opts.k ?? 12;
	const allowed = opts.allowedSources && opts.allowedSources.length > 0
		? new Set(opts.allowedSources)
		: null;
	const filterAllowed = (chunks: RetrievedChunk[]) =>
		allowed ? chunks.filter((c) => allowed.has(c.source)) : chunks;

	const semanticPromise = (async () => {
		const [embedding] = await embed([query]);
		// pgvector requires the input as the literal `[n,n,...]` string.
		const vectorLiteral = `[${embedding.join(',')}]`;

		// Try the per-source RPC first — guarantees every source gets up to
		// `perSource` chunks regardless of how chatty Cliq is. Fall back to
		// the original unfiltered match if the new RPC isn't installed yet.
		// Bumped from 3 to 6 because dense per-row spreadsheets (Construction
		// Material) often have the right answer ranked 4th–6th when many rows
		// share generic terms like "shower" or "tile".
		const perSource = 6;
		const perSourceRes = await supabase.rpc('bot_match_chunks_per_source', {
			p_deal_id: opts.dealId,
			p_query_embedding: vectorLiteral,
			p_per_source: perSource
		});

		if (!perSourceRes.error) {
			const rows = filterAllowed((perSourceRes.data ?? []) as RetrievedChunk[]);
			return rows.slice(0, Math.max(k * 3, 24));
		}

		console.warn(
			'[bot/retrieve] per_source RPC failed, falling back:',
			perSourceRes.error.message
		);
		const { data, error } = await supabase.rpc('bot_match_chunks', {
			p_deal_id: opts.dealId,
			p_query_embedding: vectorLiteral,
			p_k: k * 4
		});
		if (error) throw new Error(`bot_match_chunks failed: ${error.message}`);
		const all = filterAllowed((data ?? []) as RetrievedChunk[]);
		return diversifyBySource(all, k, 6);
	})();

	const windowDays = detectTimeWindow(query);
	const recencyPromise = windowDays
		? fetchRecentChunks({ dealId: opts.dealId, days: windowDays, limit: 12 })
		: Promise.resolve([] as RetrievedChunk[]);

	// Keyword fallback: pull any chunk that literally contains the query's
	// distinctive nouns. Catches cases where embedding similarity ranks a
	// noisy lookalike (Shower Faucet) above the actual answer (Showerhead)
	// in a dense per-row spreadsheet.
	const keywordPromise = keywordSearchChunks(opts.dealId, query, filterAllowed);

	const [semantic, recentRaw, keywordRaw] = await Promise.all([
		semanticPromise,
		recencyPromise,
		keywordPromise
	]);
	const recent = filterAllowed(recentRaw);
	const keyword = filterAllowed(keywordRaw);

	// Keyword hits go first (they're exact matches), then recency, then
	// semantic. Cap at 3× k so dense spreadsheets get fuller coverage.
	return mergeChunks(keyword, mergeChunks(recent, semantic)).slice(0, Math.max(k * 3, 24));
}

/**
 * Pick distinctive nouns out of a free-text query — words ≥4 chars that aren't
 * common stopwords or filler. Used as the search terms for keyword fallback.
 */
const STOPWORDS = new Set([
	'when',
	'what',
	'where',
	'which',
	'about',
	'with',
	'from',
	'this',
	'that',
	'have',
	'were',
	'they',
	'them',
	'will',
	'been',
	'into',
	'than',
	'more',
	'some',
	'just',
	'like',
	'over',
	'also',
	'only',
	'most',
	'every',
	'much',
	'very',
	'order',
	'ordered',
	'date',
	'dates',
	'know',
	'tell',
	'show',
	'find',
	'said',
	'their',
	'there'
]);

function extractKeywords(query: string): string[] {
	const tokens = query.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) || [];
	const uniq = new Set<string>();
	for (const t of tokens) {
		if (STOPWORDS.has(t)) continue;
		uniq.add(t);
	}
	return Array.from(uniq).slice(0, 6);
}

async function keywordSearchChunks(
	dealId: string,
	query: string,
	filterAllowed: (chunks: RetrievedChunk[]) => RetrievedChunk[]
): Promise<RetrievedChunk[]> {
	const keywords = extractKeywords(query);
	if (keywords.length === 0) return [];
	// PostgREST `or` filter — chunk content contains any keyword. We escape
	// commas in keywords (defensive — shouldn't happen for the tokens we keep).
	const orExpr = keywords
		.map((kw) => `content.ilike.%${kw.replace(/[,)(]/g, ' ')}%`)
		.join(',');
	const { data, error } = await supabase
		.from('bot_chunks')
		.select(
			'id, content, document_id, bot_documents!inner(id, source, subject, author, occurred_at, source_url, deal_id)'
		)
		.eq('bot_documents.deal_id', dealId)
		.or(orExpr)
		.limit(24);
	if (error) {
		console.warn('[bot/retrieve] keyword search failed:', error.message);
		return [];
	}
	const rows: RetrievedChunk[] = [];
	for (const r of data ?? []) {
		const docRaw = (r as any).bot_documents;
		const doc = Array.isArray(docRaw) ? docRaw[0] : docRaw;
		if (!doc) continue;
		rows.push({
			chunk_id: String(r.id),
			document_id: String(r.document_id),
			content: String(r.content ?? ''),
			source: String(doc.source ?? ''),
			subject: doc.subject ?? null,
			author: doc.author ?? null,
			occurred_at: String(doc.occurred_at ?? new Date().toISOString()),
			source_url: doc.source_url ?? null,
			similarity: 1
		});
	}
	return filterAllowed(rows);
}

const SOURCE_LABEL: Record<string, string> = {
	zoho_mail: 'Email',
	zoho_cliq_internal: 'Cliq · internal',
	zoho_cliq_external: 'Cliq · external',
	zoho_crm_note: 'CRM note',
	zoho_crm_field: 'Deal field',
	transcript: 'Transcript',
	sms: 'SMS'
};

function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toISOString().slice(0, 16).replace('T', ' ');
	} catch {
		return iso;
	}
}

/**
 * Render retrieved chunks as a numbered context block for the system prompt.
 * Each entry gets a [#N] tag the LLM can cite back. Returns null if there's
 * nothing to render.
 */
export function renderRetrievedContextBlock(chunks: RetrievedChunk[]): string | null {
	if (chunks.length === 0) return null;

	const lines: string[] = [];
	chunks.forEach((c, i) => {
		const tag = `[#${i + 1}]`;
		const label = SOURCE_LABEL[c.source] ?? c.source;
		const meta = [label, c.author, formatDate(c.occurred_at)].filter(Boolean).join(' · ');
		const subject = c.subject ? `\n  Subject: ${c.subject}` : '';
		lines.push(`${tag} ${meta}${subject}\n  ${c.content.replace(/\n/g, ' ')}`);
	});
	return lines.join('\n\n');
}
