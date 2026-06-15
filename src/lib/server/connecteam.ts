import { supabase } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';

const log = createLogger('connecteam');

export interface ParsedShift {
	uid: string;
	title: string | null;
	location: string | null;
	starts_at: string | null; // ISO (UTC)
	ends_at: string | null; // ISO (UTC)
	crew: string[];
	notes: string | null;
}

export interface ConnecteamFeed {
	id: string;
	label: string | null;
	ics_url: string;
	active: boolean | null;
	last_synced_at: string | null;
	last_sync_error: string | null;
	last_shift_count: number | null;
}

// ---------------------------------------------------------------------------
// iCalendar parsing (tuned to the Connecteam schedule feed format)
// ---------------------------------------------------------------------------

/** Join RFC-5545 folded lines (continuations start with a space or tab). */
function unfoldLines(text: string): string[] {
	const rawLines = text.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	for (const line of rawLines) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

/** Decode RFC-5545 TEXT escaping. */
function decodeText(value: string): string {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

/** Offset (zone - UTC) in ms for `date` in `timeZone`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts = dtf.formatToParts(date);
	const map: Record<string, string> = {};
	for (const p of parts) map[p.type] = p.value;
	const asUtc = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		Number(map.hour),
		Number(map.minute),
		Number(map.second)
	);
	return asUtc - date.getTime();
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (DST-aware). */
function zonedWallTimeToUtc(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	s: number,
	timeZone: string
): Date {
	const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
	const offset1 = timeZoneOffsetMs(new Date(utcGuess), timeZone);
	const offset2 = timeZoneOffsetMs(new Date(utcGuess - offset1), timeZone);
	return new Date(utcGuess - offset2);
}

/**
 * Parse a DTSTART/DTEND property into an ISO UTC string.
 * Handles: `;TZID=America/Denver:20251007T080000`, trailing-Z UTC, and
 * date-only `VALUE=DATE:20251007`.
 */
function parseDateProp(params: Record<string, string>, value: string): string | null {
	const v = value.trim();
	const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
	if (dateOnly) {
		const [, y, mo, d] = dateOnly;
		return new Date(Date.UTC(+y, +mo - 1, +d)).toISOString();
	}
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
	if (!m) return null;
	const [, y, mo, d, h, mi, s, z] = m;
	if (z === 'Z') {
		return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
	}
	const tz = params.TZID || 'America/Denver';
	try {
		return zonedWallTimeToUtc(+y, +mo, +d, +h, +mi, +s, tz).toISOString();
	} catch {
		// Fallback: treat as UTC if the zone is unknown to Intl.
		return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
	}
}

/** Pull crew names out of a Connecteam DESCRIPTION ("Employees:\n• Name\n• Name"). */
function extractCrew(description: string | null): string[] {
	if (!description) return [];
	const names: string[] = [];
	for (const line of description.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		// Bulleted employee lines.
		const bullet = t.replace(/^[•\-*]\s*/, '');
		if (bullet !== t) {
			const name = bullet.trim();
			if (name && !/^employees:?$/i.test(name)) names.push(name);
		}
	}
	return Array.from(new Set(names));
}

export function parseICalFeed(text: string): ParsedShift[] {
	const lines = unfoldLines(text);
	const shifts: ParsedShift[] = [];

	let inEvent = false;
	let cur: Record<string, { params: Record<string, string>; value: string }> = {};

	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') {
			inEvent = true;
			cur = {};
			continue;
		}
		if (line === 'END:VEVENT') {
			inEvent = false;
			const uid = cur.UID?.value?.trim();
			if (uid) {
				const description = cur.DESCRIPTION ? decodeText(cur.DESCRIPTION.value) : null;
				shifts.push({
					uid,
					title: cur.SUMMARY ? decodeText(cur.SUMMARY.value).trim() || null : null,
					location: cur.LOCATION ? decodeText(cur.LOCATION.value).trim() || null : null,
					starts_at: cur.DTSTART
						? parseDateProp(cur.DTSTART.params, cur.DTSTART.value)
						: null,
					ends_at: cur.DTEND ? parseDateProp(cur.DTEND.params, cur.DTEND.value) : null,
					crew: extractCrew(description),
					notes: description
				});
			}
			continue;
		}
		if (!inEvent) continue;

		const colon = line.indexOf(':');
		if (colon === -1) continue;
		const rawKey = line.slice(0, colon);
		const value = line.slice(colon + 1);
		const [name, ...paramParts] = rawKey.split(';');
		const params: Record<string, string> = {};
		for (const p of paramParts) {
			const eq = p.indexOf('=');
			if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
		}
		cur[name.toUpperCase()] = { params, value };
	}

	return shifts;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface FeedSyncResult {
	feedId: string;
	label: string | null;
	shiftCount: number;
	error: string | null;
}

async function syncFeed(feed: ConnecteamFeed): Promise<FeedSyncResult> {
	try {
		const res = await fetch(feed.ics_url, { headers: { Accept: 'text/calendar' } });
		if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}`);
		const text = await res.text();
		const shifts = parseICalFeed(text);

		if (shifts.length > 0) {
			const now = new Date().toISOString();
			const rows = shifts.map((s) => ({
				feed_id: feed.id,
				uid: s.uid,
				title: s.title,
				location: s.location,
				starts_at: s.starts_at,
				ends_at: s.ends_at,
				crew: s.crew,
				notes: s.notes,
				seen_at: now,
				updated_at: now
			}));
			const { error } = await supabase
				.from('connecteam_shifts')
				.upsert(rows, { onConflict: 'uid' });
			if (error) throw new Error(`Shift upsert failed: ${error.message}`);
		}

		await supabase
			.from('connecteam_feeds')
			.update({
				last_synced_at: new Date().toISOString(),
				last_sync_error: null,
				last_shift_count: shifts.length
			})
			.eq('id', feed.id);

		return { feedId: feed.id, label: feed.label, shiftCount: shifts.length, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('Connecteam feed sync failed', { feedId: feed.id, error: message });
		await supabase
			.from('connecteam_feeds')
			.update({ last_synced_at: new Date().toISOString(), last_sync_error: message })
			.eq('id', feed.id);
		return { feedId: feed.id, label: feed.label, shiftCount: 0, error: message };
	}
}

/** Sync every active feed. Returns a per-feed result summary. */
export async function syncConnecteamFeeds(): Promise<FeedSyncResult[]> {
	const { data, error } = await supabase
		.from('connecteam_feeds')
		.select('id, label, ics_url, active, last_synced_at, last_sync_error, last_shift_count')
		.eq('active', true);
	if (error) throw new Error(`Failed to load feeds: ${error.message}`);

	const feeds = (data ?? []) as ConnecteamFeed[];
	const results: FeedSyncResult[] = [];
	for (const feed of feeds) {
		results.push(await syncFeed(feed));
	}
	return results;
}

export interface ScheduleShift {
	id: string;
	uid: string;
	person: string | null;
	title: string | null;
	location: string | null;
	starts_at: string | null;
	ends_at: string | null;
	crew: string[];
}

/** Map raw rows to ScheduleShift (person = feed label) and collapse exact dupes. */
function toScheduleShifts(data: any[]): ScheduleShift[] {
	const rows = (data ?? []).map((r: any) => {
		const feed = Array.isArray(r.connecteam_feeds) ? r.connecteam_feeds[0] : r.connecteam_feeds;
		return {
			id: r.id,
			uid: r.uid,
			person: feed?.label ?? null,
			title: r.title,
			location: r.location,
			starts_at: r.starts_at,
			ends_at: r.ends_at,
			crew: r.crew ?? []
		} as ScheduleShift;
	});

	const seen = new Set<string>();
	const deduped: ScheduleShift[] = [];
	for (const r of rows) {
		const key = `${r.person ?? ''}|${r.title ?? ''}|${r.starts_at ?? ''}|${r.ends_at ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(r);
	}

	deduped.sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
	return deduped;
}

/** Upcoming shifts (today onward). */
export async function listUpcomingShifts(limit = 1000): Promise<ScheduleShift[]> {
	const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from('connecteam_shifts')
		.select('id, uid, title, location, starts_at, ends_at, crew, connecteam_feeds(label)')
		.gte('starts_at', since)
		.order('starts_at', { ascending: true })
		.limit(limit);
	if (error) throw new Error(`Failed to load shifts: ${error.message}`);
	return toScheduleShifts(data ?? []);
}

/** Shifts whose start falls in [startISO, endISO) — used by the week grid. */
export async function listShiftsForRange(
	startISO: string,
	endISO: string
): Promise<ScheduleShift[]> {
	const { data, error } = await supabase
		.from('connecteam_shifts')
		.select('id, uid, title, location, starts_at, ends_at, crew, connecteam_feeds(label)')
		.gte('starts_at', startISO)
		.lt('starts_at', endISO)
		.order('starts_at', { ascending: true })
		.limit(3000);
	if (error) throw new Error(`Failed to load shifts: ${error.message}`);
	return toScheduleShifts(data ?? []);
}

// ---------------------------------------------------------------------------
// Feed management (admin)
// ---------------------------------------------------------------------------

export interface FeedListItem {
	id: string;
	label: string | null;
	ics_url: string;
	active: boolean | null;
	last_synced_at: string | null;
	last_sync_error: string | null;
	last_shift_count: number | null;
}

export async function listFeeds(): Promise<FeedListItem[]> {
	const { data, error } = await supabase
		.from('connecteam_feeds')
		.select('id, label, ics_url, active, last_synced_at, last_sync_error, last_shift_count')
		.order('created_at', { ascending: true });
	if (error) throw new Error(`Failed to load feeds: ${error.message}`);
	return (data ?? []) as FeedListItem[];
}

export async function addFeed(label: string, icsUrl: string): Promise<void> {
	const { error } = await supabase
		.from('connecteam_feeds')
		.insert({ label: label || null, ics_url: icsUrl, active: true });
	if (error) throw new Error(error.message);
}

export async function deleteFeed(id: string): Promise<void> {
	const { error } = await supabase.from('connecteam_feeds').delete().eq('id', id);
	if (error) throw new Error(error.message);
}
