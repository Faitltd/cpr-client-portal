/**
 * Shared event-date parsing for ingesters.
 *
 * Every ingested document carries `occurred_at` (the true event time) so that
 * time-bounded retrieval ("this week", "today") is correct. Several Zoho
 * endpoints omit or oddly-format their timestamps; the old per-ingester
 * helpers silently fell back to `new Date()` (the sync moment), which made old
 * records look like they happened today and let the assistant claim things
 * happened "this week" that didn't.
 *
 * `resolveEventDate` instead reports whether the date is real. Callers write
 * the `estimated` flag to `bot_documents.date_estimated` so retrieval can
 * exclude sync-time guesses from date windows.
 */

/**
 * Parse a single date value into an ISO string, or null when it can't be
 * parsed. Handles epoch millis/seconds, Zoho's formatted strings
 * ("MM-DD-YYYY", "MM/DD/YYYY", optional time), ISO dates, and anything the
 * Date constructor accepts. Never returns "now" — a missing date is null.
 */
export function parseEventDate(value: any): string | null {
	if (value === null || value === undefined || value === '') return null;

	// Epoch millis (>1e12) or seconds.
	const n = Number(value);
	if (Number.isFinite(n) && n > 0 && /^\d+$/.test(String(value).trim())) {
		const d = new Date(n > 1e12 ? n : n * 1000);
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}

	const s = String(value).trim();

	// Zoho formatted dates: MM-DD-YYYY or MM/DD/YYYY, optional HH:mm(:ss).
	const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
	if (m) {
		const [, mm, dd, yyyy, hh = '0', mi = '0', ss = '0'] = m;
		const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss));
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}

	const d = new Date(s);
	if (!Number.isNaN(d.getTime())) return d.toISOString();
	return null;
}

/**
 * Resolve the real event date from a priority-ordered list of candidates.
 * Returns the first that parses with `estimated: false`. If none parse, falls
 * back to the sync moment with `estimated: true` so the row is treated as
 * undated by time-bounded retrieval rather than dated "now".
 */
export function resolveEventDate(...candidates: any[]): { iso: string; estimated: boolean } {
	for (const c of candidates) {
		const iso = parseEventDate(c);
		if (iso) return { iso, estimated: false };
	}
	return { iso: new Date().toISOString(), estimated: true };
}
