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
	/**
	 * If set, only keep WorkDrive chunks whose document `metadata.top_folder`
	 * (the deal's direct subfolder name where the file lives — e.g. "Designs",
	 * "SOW", "Permits") is in this list. Used to gate trade partners to
	 * Designs-only files even though they can read all workdrive_* sources.
	 * Non-WorkDrive sources are unaffected by this filter.
	 */
	allowedTopFolders?: string[] | null;
}): Promise<RetrievedChunk[]> {
	const query = opts.query.trim();
	if (!query) return [];

	const k = opts.k ?? 12;
	const allowed = opts.allowedSources && opts.allowedSources.length > 0
		? new Set(opts.allowedSources)
		: null;
	const filterAllowed = (chunks: RetrievedChunk[]) =>
		allowed ? chunks.filter((c) => allowed.has(c.source)) : chunks;
	const allowedTopFolders =
		opts.allowedTopFolders && opts.allowedTopFolders.length > 0
			? new Set(opts.allowedTopFolders.map((s) => s.toLowerCase()))
			: null;

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
		const perSource = 10;
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

	// Books always-on: when the query is finance-related, the bot needs to
	// see EVERY invoice / estimate / payment for the deal — semantic search
	// gets crowded out by mail mentioning "Financials" and only returns a
	// fraction. Fetch all Books chunks directly when finance keywords appear.
	const financePromise = looksFinancial(query)
		? fetchAllBooksChunks(opts.dealId, filterAllowed)
		: Promise.resolve([] as RetrievedChunk[]);

	const [semantic, recentRaw, keywordRaw, financeRaw] = await Promise.all([
		semanticPromise,
		recencyPromise,
		keywordPromise,
		financePromise
	]);
	const recent = filterAllowed(recentRaw);
	const keyword = filterAllowed(keywordRaw);
	const finance = filterAllowed(financeRaw);

	// Finance-must-see chunks first (Books invoice/estimate/payment), then
	// keyword exact matches, then recency, then semantic. Cap at 3× k.
	const merged = mergeChunks(
		finance,
		mergeChunks(keyword, mergeChunks(recent, semantic))
	).slice(0, Math.max(k * 3, 24));

	// Top-folder gate (trade partners → Designs only). Only filters WorkDrive
	// chunks; everything else passes through. Non-allowed WorkDrive chunks are
	// dropped silently.
	// Fetch the workdrive doc metadata once, then use it for both the
	// top_folder gate AND the external-share URL substitution. Trade
	// partners and clients can't open internal /file/{id} URLs (no Zoho
	// login), so we replace source_url with the cached external share when
	// one exists.
	const workdriveDocIds = Array.from(
		new Set(merged.filter((c) => c.source.startsWith('workdrive_')).map((c) => c.document_id))
	);
	if (workdriveDocIds.length === 0) return merged;

	const { data: docMeta, error: docMetaErr } = await supabase
		.from('bot_documents')
		.select('id, metadata')
		.in('id', workdriveDocIds);
	if (docMetaErr) {
		console.warn('[bot/retrieve] doc-meta lookup failed:', docMetaErr.message);
		return allowedTopFolders ? merged : merged;
	}
	const docTopFolder = new Map<string, string | null>();
	const docFileId = new Map<string, string | null>();
	for (const d of docMeta ?? []) {
		const md = (d as any).metadata ?? {};
		const tf = md.top_folder;
		const fid = md.workdrive_file_id;
		docTopFolder.set((d as any).id, typeof tf === 'string' ? tf.toLowerCase() : null);
		docFileId.set((d as any).id, typeof fid === 'string' && fid ? fid : null);
	}

	// Look up external share URLs for every workdrive file we have.
	const fileIds = Array.from(
		new Set(Array.from(docFileId.values()).filter((v): v is string => !!v))
	);
	const externalUrlByFileId = new Map<string, string>();
	if (fileIds.length > 0) {
		const { data: shares, error: shareErr } = await supabase
			.from('workdrive_file_shares')
			.select('file_id, external_url')
			.in('file_id', fileIds);
		if (shareErr) {
			console.warn('[bot/retrieve] share-url lookup failed:', shareErr.message);
		} else {
			for (const s of shares ?? []) {
				externalUrlByFileId.set((s as any).file_id, (s as any).external_url);
			}
		}
	}

	// Apply: gate by top_folder (if set) AND swap to external URL.
	const filtered = merged.filter((c) => {
		if (!c.source.startsWith('workdrive_')) return true;
		if (!allowedTopFolders) return true;
		const tf = docTopFolder.get(c.document_id);
		return tf != null && allowedTopFolders.has(tf);
	});
	return filtered.map((c) => {
		if (!c.source.startsWith('workdrive_')) return c;
		const fid = docFileId.get(c.document_id);
		const ext = fid ? externalUrlByFileId.get(fid) : undefined;
		return ext ? { ...c, source_url: ext } : c;
	});
}

const FINANCE_RE = /\b(balance|invoice|invoices|owed|owe|outstanding|remaining|paid|payment|payments|due|financial|finances|cost|costs|billed|bill|estimate|estimates|credit|credits|refund|deposit|retainer|amount|summary|itemized|itemize)\b/i;

function looksFinancial(query: string): boolean {
	return FINANCE_RE.test(query);
}

async function fetchAllBooksChunks(
	dealId: string,
	filterAllowed: (chunks: RetrievedChunk[]) => RetrievedChunk[]
): Promise<RetrievedChunk[]> {
	const { data, error } = await supabase
		.from('bot_documents')
		.select(
			'id, source, subject, author, occurred_at, source_url, bot_chunks!inner(id, content)'
		)
		.eq('deal_id', dealId)
		.in('source', ['zoho_books_invoice', 'zoho_books_estimate', 'zoho_books_payment'])
		.order('occurred_at', { ascending: false })
		.limit(50);
	if (error) {
		console.warn('[bot/retrieve] finance fetch failed:', error.message);
		return [];
	}
	const out: RetrievedChunk[] = [];
	for (const doc of data ?? []) {
		const chunks = Array.isArray(doc.bot_chunks) ? doc.bot_chunks : [];
		for (const ch of chunks) {
			out.push({
				chunk_id: ch.id,
				document_id: doc.id,
				content: ch.content,
				source: doc.source,
				subject: doc.subject ?? null,
				author: doc.author ?? null,
				occurred_at: doc.occurred_at,
				source_url: doc.source_url ?? null,
				similarity: 1 // direct fetch — treat as fully relevant
			});
		}
	}
	return filterAllowed(out);
}

/**
 * Pick distinctive nouns out of a free-text query — words ≥6 chars (long enough
 * to be specific) that aren't common stopwords or generic CRM filler.
 *
 * Minimum length matters: 4-char words like "model" match "reMODELing" inside
 * unrelated emails and flood the result set with false positives.
 */
const STOPWORDS = new Set([
	'about',
	'after',
	'again',
	'aren\'t',
	'before',
	'being',
	'between',
	'could',
	'date',
	'dates',
	'deliveries',
	'delivery',
	'didn\'t',
	'doing',
	'doesn\'t',
	'during',
	'every',
	'find',
	'found',
	'going',
	'have',
	'haven\'t',
	'here',
	'into',
	'isn\'t',
	'know',
	'like',
	'maybe',
	'model',
	'models',
	'more',
	'number',
	'numbers',
	'most',
	'much',
	'need',
	'often',
	'only',
	'order',
	'ordered',
	'orders',
	'over',
	'project',
	'said',
	'show',
	'shown',
	'some',
	'something',
	'still',
	'such',
	'tell',
	'than',
	'that',
	'their',
	'them',
	'then',
	'there',
	'these',
	'they',
	'thing',
	'things',
	'this',
	'those',
	'today',
	'told',
	'used',
	'using',
	'very',
	'want',
	'wants',
	'were',
	'what',
	'when',
	'where',
	'which',
	'while',
	'will',
	'with',
	'would',
	'years'
]);

function extractKeywords(query: string): string[] {
	const tokens = query.toLowerCase().match(/[a-z][a-z'-]{5,}/g) || [];
	const uniq = new Set<string>();
	for (const t of tokens) {
		if (STOPWORDS.has(t)) continue;
		uniq.add(t);
	}
	// Prefer the longest tokens — they're the most distinctive.
	return Array.from(uniq)
		.sort((a, b) => b.length - a.length)
		.slice(0, 4);
}

async function keywordSearchChunks(
	dealId: string,
	query: string,
	filterAllowed: (chunks: RetrievedChunk[]) => RetrievedChunk[]
): Promise<RetrievedChunk[]> {
	const keywords = extractKeywords(query);
	if (keywords.length === 0) return [];
	const { data, error } = await supabase.rpc('bot_keyword_chunks', {
		p_deal_id: dealId,
		p_keywords: keywords,
		p_limit: 24
	});
	if (error) {
		console.warn('[bot/retrieve] keyword RPC failed:', error.message);
		return [];
	}
	const rows: RetrievedChunk[] = (data ?? []).map((r: any) => ({
		chunk_id: String(r.chunk_id),
		document_id: String(r.document_id),
		content: String(r.content ?? ''),
		source: String(r.source ?? ''),
		subject: r.subject ?? null,
		author: r.author ?? null,
		occurred_at: String(r.occurred_at ?? new Date().toISOString()),
		source_url: r.source_url ?? null,
		similarity: typeof r.similarity === 'number' ? r.similarity : 1
	}));
	return filterAllowed(rows);
}

const SOURCE_LABEL: Record<string, string> = {
	zoho_mail: 'Email',
	zoho_cliq_internal: 'Cliq · internal',
	zoho_cliq_external: 'Cliq · external',
	zoho_crm_note: 'CRM note',
	zoho_crm_field: 'Deal field',
	zoho_projects_task: 'Projects · task',
	zoho_projects_activity: 'Projects · activity',
	zoho_sign_request: 'Sign · document',
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

// Higher number = higher priority in the rendered prompt. Books / WorkDrive
// structured records get surfaced ahead of chatty Cliq messages so the LLM
// doesn't bury its citations in noise.
const SOURCE_PRIORITY: Record<string, number> = {
	zoho_books_invoice: 100,
	zoho_books_estimate: 95,
	zoho_books_payment: 90,
	zoho_sign_request: 88,
	zoho_projects_task: 85,
	zoho_projects_activity: 80,
	workdrive_xlsx: 70,
	workdrive_pdf: 65,
	workdrive_docx: 65,
	transcript: 60,
	zoho_crm_note: 55,
	zoho_crm_field: 55,
	zoho_mail: 40,
	zoho_cliq_internal: 30,
	zoho_cliq_external: 20,
	sms: 15
};

/**
 * Render retrieved chunks as a numbered context block for the system prompt.
 * Each entry gets a [#N] tag the LLM can cite back. Returns null if there's
 * nothing to render. Chunks are reordered so structured records (Books,
 * WorkDrive) appear ahead of chatty sources (Cliq, Mail) — the LLM pays more
 * attention to chunks near the top of the prompt.
 */
export function renderRetrievedContextBlock(chunks: RetrievedChunk[]): string | null {
	if (chunks.length === 0) return null;

	const sorted = [...chunks].sort((a, b) => {
		const pa = SOURCE_PRIORITY[a.source] ?? 0;
		const pb = SOURCE_PRIORITY[b.source] ?? 0;
		if (pb !== pa) return pb - pa;
		// Within same source: newest first.
		return (b.occurred_at ?? '').localeCompare(a.occurred_at ?? '');
	});

	const lines: string[] = [];
	sorted.forEach((c, i) => {
		const tag = `[#${i + 1}]`;
		const label = SOURCE_LABEL[c.source] ?? c.source;
		const meta = [label, c.author, formatDate(c.occurred_at)].filter(Boolean).join(' · ');
		const subject = c.subject ? `\n  Subject: ${c.subject}` : '';
		const url = c.source_url ? `\n  URL: ${c.source_url}` : '';
		lines.push(`${tag} ${meta}${subject}${url}\n  ${c.content.replace(/\n/g, ' ')}`);
	});
	return lines.join('\n\n');
}
