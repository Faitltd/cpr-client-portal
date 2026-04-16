/**
 * Note timestamp helpers. Small, pure, and UI-local so the dashboard can render
 * both a scannable relative label ("2h ago") and an exact absolute timestamp
 * ("Apr 16, 2026, 3:45 PM") without pulling in a date library.
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;

function safeDate(iso: string | null | undefined): Date | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date;
}

/**
 * Short, scannable relative label for the latest-note header.
 * Examples: "just now", "12m ago", "3h ago", "yesterday", "5d ago", "Apr 1"
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
	const date = safeDate(iso);
	if (!date) return '—';

	const diffMs = now.getTime() - date.getTime();
	const diffSec = Math.round(diffMs / 1000);

	if (diffSec < 5) return 'just now';
	if (diffSec < MINUTE) return `${diffSec}s ago`;
	if (diffSec < HOUR) return `${Math.floor(diffSec / MINUTE)}m ago`;
	if (diffSec < DAY) return `${Math.floor(diffSec / HOUR)}h ago`;

	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) return 'today';

	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (
		date.getFullYear() === yesterday.getFullYear() &&
		date.getMonth() === yesterday.getMonth() &&
		date.getDate() === yesterday.getDate()
	) {
		return 'yesterday';
	}

	if (diffSec < WEEK) return `${Math.floor(diffSec / DAY)}d ago`;

	const sameYear = date.getFullYear() === now.getFullYear();
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' })
	});
}

/**
 * Long, unambiguous timestamp for tooltips and accessibility labels.
 * Example: "April 16, 2026 at 3:45 PM"
 */
export function formatAbsoluteTimestamp(iso: string | null | undefined): string {
	const date = safeDate(iso);
	if (!date) return '';
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

/**
 * Compact timestamp used inline inside history items.
 * Example: "Apr 16, 3:45 PM"
 */
export function formatCompactTimestamp(iso: string | null | undefined): string {
	const date = safeDate(iso);
	if (!date) return '—';
	const now = new Date();
	const sameYear = date.getFullYear() === now.getFullYear();
	return date.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit'
	});
}
