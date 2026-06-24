import { createHash } from 'crypto';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { chunkText, embed } from './embeddings';

// Display timezone for shift times (matches cpr-shift-sync's SYNC_TIMEZONE).
const DISPLAY_TZ = 'America/Denver';

export interface ShiftsSyncResult {
	dealId: string;
	dealName: string | null;
	shifts: { source: 'cpr_shift'; processed: number; inserted: number; skipped: number; pruned: number };
	error?: string;
}

interface ShiftRow {
	id: string;
	shift_date: string | null;
	start_ts: string | null;
	end_ts: string | null;
	employee: string | null;
	employee_email: string | null;
	role: string | null;
	job_site: string | null;
	task: string | null;
	notes: string | null;
	schedule: string | null;
	is_open: boolean | null;
	is_published: boolean | null;
	content_hash: string | null;
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
}

async function fetchDealName(dealId: string): Promise<string | null> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const res = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name`,
		{},
		apiDomain
	);
	const rec = res?.data?.[0] ?? {};
	return typeof rec.Deal_Name === 'string' ? rec.Deal_Name : null;
}

// All shifts in the rolling window are org-wide; cache them for the duration of
// a sync run so a 25-deal batch doesn't re-query per deal.
let shiftCache: { at: number; rows: ShiftRow[] } | null = null;
async function getAllShifts(): Promise<ShiftRow[]> {
	if (shiftCache && Date.now() - shiftCache.at < 60_000) return shiftCache.rows;
	const { data, error } = await supabase.from('cpr_shifts').select('*');
	if (error) throw new Error(`cpr_shifts read failed: ${error.message}`);
	shiftCache = { at: Date.now(), rows: (data ?? []) as ShiftRow[] };
	return shiftCache.rows;
}

function norm(s: string | null | undefined): string {
	return (s ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Associate a shift's job site (the Connecteam Job = client/site name, often a
 * surname like "Guikema" or a full name like "Stephen Blume") with a Deal whose
 * name contains that client (e.g. "Mark Guikema - Project Created"). Matches on
 * containment in either direction, or a shared word of length >= 4 (surname).
 */
function shiftMatchesDeal(jobSite: string | null, dealName: string | null): boolean {
	const j = norm(jobSite);
	const d = norm(dealName);
	if (!j || !d) return false;
	if (d.includes(j) || j.includes(d)) return true;
	const dTokens = new Set(d.split(' ').filter((t) => t.length >= 4));
	for (const t of j.split(' ')) {
		if (t.length >= 4 && dTokens.has(t)) return true;
	}
	return false;
}

function fmtRange(startIso: string | null, endIso: string | null): string {
	if (!startIso) return 'time unknown';
	try {
		const start = new Date(startIso);
		const dayFmt = new Intl.DateTimeFormat('en-US', {
			timeZone: DISPLAY_TZ,
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
		const timeFmt = new Intl.DateTimeFormat('en-US', {
			timeZone: DISPLAY_TZ,
			hour: 'numeric',
			minute: '2-digit'
		});
		const day = dayFmt.format(start);
		const startT = timeFmt.format(start);
		const endT = endIso ? timeFmt.format(new Date(endIso)) : '';
		return endT ? `${day}, ${startT}–${endT} MT` : `${day}, ${startT} MT`;
	} catch {
		return startIso;
	}
}

function renderShift(s: ShiftRow): {
	subject: string;
	body: string;
	sourceId: string;
	occurredAt: string;
	metadata: any;
} {
	const when = fmtRange(s.start_ts, s.end_ts);
	const who = s.is_open
		? 'Open (unassigned)'
		: `${s.employee ?? s.employee_email ?? 'Unknown'}${s.role ? ` (${s.role})` : ''}`;
	const task = s.task || s.notes || '';
	const site = s.job_site || 'unspecified job site';

	const lines: string[] = [];
	lines.push(`When: ${when}`);
	lines.push(`Who: ${who}`);
	lines.push(`Job site / client: ${site}`);
	if (task) lines.push(`Task: ${task}`);
	if (s.schedule) lines.push(`Schedule: ${s.schedule}`);
	if (s.notes && s.notes !== task) lines.push(`Notes: ${s.notes}`);
	lines.push(`Status: ${s.is_published ? 'published' : 'unpublished'}`);

	const body = lines.join('\n');
	const subjectTask = task ? ` · ${task}` : '';
	return {
		subject: `Shift · ${site} · ${s.shift_date ?? ''}${subjectTask}`.trim(),
		body,
		sourceId: `shift:${s.id}`,
		occurredAt: s.start_ts ?? new Date().toISOString(),
		metadata: {
			shift_id: s.id,
			shift_date: s.shift_date,
			start: s.start_ts,
			end: s.end_ts,
			job_site: s.job_site,
			role: s.role,
			employee_email: s.employee_email,
			is_open: !!s.is_open,
			is_published: !!s.is_published
		}
	};
}

async function ingestRendered(
	dealId: string,
	source: 'cpr_shift',
	author: string | null,
	rec: { subject: string; body: string; sourceId: string; occurredAt: string; metadata?: any }
): Promise<'inserted' | 'skipped'> {
	const docRow = {
		deal_id: dealId,
		source,
		source_id: rec.sourceId,
		source_url: null,
		author,
		occurred_at: rec.occurredAt,
		subject: rec.subject,
		body: rec.body,
		metadata: rec.metadata ?? {},
		hash: hashBody(rec.body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', rec.sourceId)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(`${rec.subject}\n${rec.body}`, 1500, 200);
	if (chunks.length === 0) return 'inserted';
	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

/**
 * Associate Zoho/Connecteam shift records (mirrored into cpr_shifts) with a Deal
 * by matching the shift's job site to the Deal name, and ingest each matched
 * shift as a cpr_shift document. Prunes shift documents for this deal that no
 * longer match (e.g. shift removed or rolled out of the window).
 */
export async function syncShiftsForDeal(dealId: string): Promise<ShiftsSyncResult> {
	const result: ShiftsSyncResult = {
		dealId,
		dealName: null,
		shifts: { source: 'cpr_shift', processed: 0, inserted: 0, skipped: 0, pruned: 0 }
	};

	let dealName: string | null;
	try {
		dealName = await fetchDealName(dealId);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'fetch deal name failed';
		return result;
	}
	if (!dealName) {
		result.error = 'no Deal_Name';
		return result;
	}
	result.dealName = dealName;

	let allShifts: ShiftRow[];
	try {
		allShifts = await getAllShifts();
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'cpr_shifts read failed';
		return result;
	}

	const matched = allShifts.filter((s) => shiftMatchesDeal(s.job_site, dealName));
	const keepIds = new Set<string>();

	for (const s of matched) {
		const rec = renderShift(s);
		keepIds.add(rec.sourceId);
		result.shifts.processed += 1;
		try {
			const status = await ingestRendered(
				dealId,
				'cpr_shift',
				s.employee ?? s.employee_email ?? null,
				rec
			);
			if (status === 'inserted') result.shifts.inserted += 1;
			else result.shifts.skipped += 1;
		} catch (err) {
			result.shifts.skipped += 1;
			console.warn('[bot/ingest-shifts] shift ingest failed:', err instanceof Error ? err.message : err);
		}
	}

	// Prune shift docs for this deal that no longer match (removed / rolled out
	// of the window / re-associated to another job site).
	try {
		const { data: existing } = await supabase
			.from('bot_documents')
			.select('id, source_id')
			.eq('source', 'cpr_shift')
			.eq('deal_id', dealId);
		const stale = (existing ?? []).filter((d: any) => !keepIds.has(d.source_id));
		for (const d of stale) {
			await supabase.from('bot_chunks').delete().eq('document_id', d.id);
			await supabase.from('bot_documents').delete().eq('id', d.id);
			result.shifts.pruned += 1;
		}
	} catch (err) {
		console.warn('[bot/ingest-shifts] prune failed:', err instanceof Error ? err.message : err);
	}

	return result;
}
