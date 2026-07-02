import { createHash } from 'crypto';
import { supabase } from '$lib/server/db';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { chunkText, embed } from './embeddings';
import { resolveEventDate } from './date-util';

// Zoho Calendar API lives on its own host (NOT the CRM zohoApiCall base).
// US data center. If the org is migrated to another DC, derive this from the
// token's api_domain TLD instead of hardcoding.
const CALENDAR_API_BASE = 'https://calendar.zoho.com/api/v1';

// How far back / forward to scan for bookings, in days. Zoho caps each events
// query at 31 days, so we page through <=30-day windows.
const LOOKBACK_DAYS = 31;
const LOOKAHEAD_DAYS = 62;
const WINDOW_DAYS = 30;

export interface CalendarSyncResult {
	dealId: string;
	customerEmail: string | null;
	events: { source: 'zoho_calendar'; processed: number; inserted: number; skipped: number };
	error?: string;
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho not connected');
	const accessToken = valid.accessToken;
	const apiDomain = valid.apiDomain;
	return { accessToken, apiDomain };
}

async function fetchDealContactEmail(dealId: string): Promise<string | null> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Contact_Name,Email,Email_1`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const dealEmail =
		(typeof rec.Email_1 === 'string' && rec.Email_1) ||
		(typeof rec.Email === 'string' && rec.Email) ||
		null;
	if (dealEmail) return dealEmail;

	const contactRef = rec.Contact_Name;
	const contactId =
		contactRef && typeof contactRef === 'object' && 'id' in contactRef
			? String((contactRef as any).id)
			: null;
	if (!contactId) return null;
	try {
		const cRes = await zohoApiCall(
			accessToken,
			`/Contacts/${encodeURIComponent(contactId)}?fields=Email`,
			{},
			apiDomain
		);
		const cRec = cRes?.data?.[0] ?? {};
		return typeof cRec.Email === 'string' ? cRec.Email : null;
	} catch {
		return null;
	}
}

/**
 * Authenticated GET against the Zoho Calendar API. Separate from zohoApiCall
 * because Calendar uses a different host and the `application/json+large`
 * Accept header (required to receive event descriptions).
 */
async function calendarApiGet(accessToken: string, path: string): Promise<any> {
	const res = await fetch(`${CALENDAR_API_BASE}${path}`, {
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`,
			Accept: 'application/json+large'
		}
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Calendar API ${res.status}: ${text.slice(0, 300)}`);
	}
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
}

/** Format a Date as Zoho's yyyyMMdd"T"HHmmss"Z" stamp. */
function toCalStamp(d: Date): string {
	return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/**
 * Parse a Zoho calendar stamp into an ISO string. Handles:
 *   20240608, 20240608T205000, 20240608T205000Z, 20240608T205000+0530
 */
function calStampToIso(s: string): string | null {
	if (!s) return null;
	const m = String(s).match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z|[+-]\d{4})?$/
	);
	if (!m) {
		const d = new Date(String(s));
		return Number.isNaN(d.getTime()) ? null : d.toISOString();
	}
	const [, Y, Mo, D, h = '00', mi = '00', se = '00', tz] = m;
	let iso = `${Y}-${Mo}-${D}T${h}:${mi}:${se}`;
	if (!tz || tz === 'Z') iso += 'Z';
	else iso += `${tz.slice(0, 3)}:${tz.slice(3)}`; // +0530 -> +05:30
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface CalendarRef {
	uid: string;
	name: string;
}

async function listCalendars(accessToken: string): Promise<CalendarRef[]> {
	const data = await calendarApiGet(accessToken, '/calendars?category=all');
	const cals = Array.isArray(data?.calendars) ? data.calendars : [];
	return cals
		.map((c: any) => ({ uid: String(c?.uid ?? ''), name: String(c?.name ?? '') }))
		.filter((c: CalendarRef) => c.uid);
}

async function listEventsInWindow(
	accessToken: string,
	calUid: string,
	start: Date,
	end: Date
): Promise<any[]> {
	const range = encodeURIComponent(
		JSON.stringify({ start: toCalStamp(start), end: toCalStamp(end) })
	);
	const data = await calendarApiGet(
		accessToken,
		`/calendars/${encodeURIComponent(calUid)}/events?range=${range}`
	);
	return Array.isArray(data?.events) ? data.events : [];
}

function buildWindows(backDays: number, fwdDays: number): { start: Date; end: Date }[] {
	const now = Date.now();
	const sliceMs = WINDOW_DAYS * 86400000;
	const endMs = now + fwdDays * 86400000;
	const windows: { start: Date; end: Date }[] = [];
	let s = now - backDays * 86400000;
	while (s < endMs) {
		const e = Math.min(s + sliceMs, endMs);
		windows.push({ start: new Date(s), end: new Date(e) });
		s = e;
	}
	return windows;
}

function eventMatchesEmail(ev: any, email: string): boolean {
	const lc = email.toLowerCase();
	const attendees = Array.isArray(ev?.attendees) ? ev.attendees : [];
	if (attendees.some((a: any) => String(a?.email ?? '').toLowerCase() === lc)) return true;
	if (String(ev?.organizer ?? '').toLowerCase() === lc) return true;
	if (String(ev?.createdby ?? '').toLowerCase() === lc) return true;
	return false;
}

function renderEvent(ev: any): {
	subject: string;
	body: string;
	sourceId: string;
	occurredAt: string;
	dateEstimated: boolean;
	metadata: any;
} {
	const title = String(ev?.title ?? 'Untitled event');
	const dt = ev?.dateandtime ?? {};
	const startRaw = String(dt.start ?? ev?.start ?? '');
	const endRaw = String(dt.end ?? ev?.end ?? '');
	const tz = String(dt.timezone ?? '');
	const isAllDay = ev?.isallday === true;
	const startParsed = calStampToIso(startRaw);
	const endIso = calStampToIso(endRaw);
	// Use the parsed start; if the stamp was unparseable, fall back (flagged).
	const { iso: startIso, estimated: dateEstimated } = startParsed
		? { iso: startParsed, estimated: false }
		: resolveEventDate(startRaw);

	const attendees = (Array.isArray(ev?.attendees) ? ev.attendees : [])
		.map((a: any) => {
			const e = String(a?.email ?? '').trim();
			const st = String(a?.status ?? '').trim();
			return e ? (st ? `${e} (${st})` : e) : '';
		})
		.filter(Boolean);

	const lines: string[] = [];
	lines.push(`Event: ${title}`);
	lines.push(
		`When: ${startRaw} → ${endRaw}${tz ? ` (${tz})` : ''}${isAllDay ? ' [all-day]' : ''}`
	);
	if (ev?.organizer) lines.push(`Organizer: ${ev.organizer}`);
	if (attendees.length) lines.push(`Attendees: ${attendees.join(', ')}`);
	if (ev?.location) lines.push(`Location: ${ev.location}`);
	if (ev?.description) lines.push(`Details: ${String(ev.description).slice(0, 2000)}`);

	const body = lines.join('\n');
	const uid = String(ev?.uid ?? ev?.etag ?? hashBody(body));
	// Include the start in the source_id so distinct instances of a recurring
	// booking don't collapse onto one record.
	return {
		subject: `Calendar · ${title} · ${startRaw}`,
		body,
		sourceId: `calendar:${uid}:${startRaw}`,
		occurredAt: startIso,
		dateEstimated,
		metadata: {
			uid,
			caluid: ev?.caluid ?? null,
			title,
			start: startIso,
			end: endIso,
			timezone: tz,
			all_day: isAllDay
		}
	};
}

async function ingestRendered(
	dealId: string,
	source: 'zoho_calendar',
	author: string | null,
	rec: { subject: string; body: string; sourceId: string; occurredAt: string; dateEstimated?: boolean; metadata?: any }
): Promise<'inserted' | 'skipped'> {
	const docRow = {
		deal_id: dealId,
		source,
		source_id: rec.sourceId,
		source_url: null,
		author,
		occurred_at: rec.occurredAt,
		date_estimated: rec.dateEstimated ?? false,
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
 * Pull Zoho Calendar events whose attendee/organizer matches the Deal's
 * primary-contact email, and ingest them as zoho_calendar documents so the bot
 * can answer booking/appointment-time questions from real calendar data.
 */
export async function syncCalendarForDeal(dealId: string): Promise<CalendarSyncResult> {
	const result: CalendarSyncResult = {
		dealId,
		customerEmail: null,
		events: { source: 'zoho_calendar', processed: 0, inserted: 0, skipped: 0 }
	};

	let email: string | null;
	try {
		email = await fetchDealContactEmail(dealId);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'fetch email failed';
		return result;
	}
	if (!email) {
		result.error = 'no contact email on Deal';
		return result;
	}
	result.customerEmail = email;

	const { accessToken } = await getValidAccessToken();

	let calendars: CalendarRef[];
	try {
		calendars = await listCalendars(accessToken);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'calendar list failed';
		return result;
	}

	const windows = buildWindows(LOOKBACK_DAYS, LOOKAHEAD_DAYS);
	const seen = new Set<string>();

	for (const cal of calendars) {
		for (const w of windows) {
			let events: any[];
			try {
				events = await listEventsInWindow(accessToken, cal.uid, w.start, w.end);
			} catch (err) {
				console.warn(
					`[bot/ingest-calendar] events failed (cal=${cal.name}):`,
					err instanceof Error ? err.message : err
				);
				continue;
			}
			for (const ev of events) {
				if (!eventMatchesEmail(ev, email)) continue;
				const rec = renderEvent(ev);
				if (seen.has(rec.sourceId)) continue;
				seen.add(rec.sourceId);
				result.events.processed += 1;
				try {
					const status = await ingestRendered(
						dealId,
						'zoho_calendar',
						(ev?.organizer as string) ?? null,
						rec
					);
					if (status === 'inserted') result.events.inserted += 1;
					else result.events.skipped += 1;
				} catch (err) {
					result.events.skipped += 1;
					console.warn(
						'[bot/ingest-calendar] event ingest failed:',
						err instanceof Error ? err.message : err
					);
				}
			}
		}
	}

	return result;
}
