/**
 * In-memory fixed-window rate limiter for login endpoints. Phone-number
 * fallback passwords are low entropy, so throttling is the primary defense
 * against brute force and account enumeration.
 *
 * Limits are tracked per key (e.g. `login:<email>:<ip>`). State is per
 * process — good enough for a single-instance deployment; swap for a shared
 * store if the app is ever scaled horizontally.
 */

type WindowEntry = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IDENTITY = 10;
const MAX_ATTEMPTS_PER_IP = 50;
const MAX_ENTRIES = 50_000;

const windows = new Map<string, WindowEntry>();

function bump(key: string, limit: number, now: number): { allowed: boolean; retryAfterSec: number } {
	const entry = windows.get(key);
	if (!entry || now >= entry.resetAt) {
		windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return { allowed: true, retryAfterSec: 0 };
	}
	entry.count += 1;
	if (entry.count > limit) {
		return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
	}
	return { allowed: true, retryAfterSec: 0 };
}

function pruneIfNeeded(now: number) {
	if (windows.size < MAX_ENTRIES) return;
	for (const [key, entry] of windows) {
		if (now >= entry.resetAt) windows.delete(key);
	}
	// Hard backstop if everything is somehow still live.
	if (windows.size >= MAX_ENTRIES) windows.clear();
}

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

/**
 * Record a login attempt for an identity (usually an email) from an IP.
 * Returns allowed=false when either the identity or the IP has exceeded its
 * window. Call this BEFORE verifying credentials.
 */
export function checkLoginRateLimit(identity: string, ip: string | null): RateLimitResult {
	const now = Date.now();
	pruneIfNeeded(now);

	const normalizedIdentity = identity.trim().toLowerCase() || 'unknown';
	const normalizedIp = (ip || 'unknown').trim();

	const byIdentity = bump(`id:${normalizedIdentity}:${normalizedIp}`, MAX_ATTEMPTS_PER_IDENTITY, now);
	const byIp = bump(`ip:${normalizedIp}`, MAX_ATTEMPTS_PER_IP, now);

	if (!byIdentity.allowed || !byIp.allowed) {
		return {
			allowed: false,
			retryAfterSec: Math.max(byIdentity.retryAfterSec, byIp.retryAfterSec)
		};
	}
	return { allowed: true, retryAfterSec: 0 };
}

/** Test hook — clears all rate-limit state. */
export function resetLoginRateLimits() {
	windows.clear();
}
