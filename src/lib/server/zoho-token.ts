import {
	getZohoTokens,
	getZohoTokenByUserId,
	upsertZohoTokens,
	type ZohoTokens
} from './db';
import { refreshAccessToken } from './zoho';

/**
 * Result of resolving a usable Zoho access token.
 *
 * - `accessToken` is always valid (refreshed if the stored one had expired).
 * - `apiDomain` is the region domain from the refresh response when available;
 *   it is not persisted, so it is only populated on requests that refreshed.
 * - `tokens` is the stored row (pre-refresh values for user_id / scope / email).
 */
export interface ValidZohoToken {
	accessToken: string;
	apiDomain?: string;
	tokens: ZohoTokens;
}

/**
 * Convert a refresh response's `expires_at` (epoch ms) to an ISO string,
 * falling back to the previous expiry — and finally to now + 5 min — if the
 * value is somehow unparseable. Mirrors the defensive logic that previously
 * lived inline in designer.ts.
 */
function toSafeIso(value: unknown, fallback?: unknown): string {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback !== undefined) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

/**
 * Given a stored token row, return a valid access token, refreshing and
 * persisting first if the stored one has expired. Returns `null` when the row
 * is missing so callers can throw their own context-specific error.
 */
async function ensureFresh(tokens: ZohoTokens | null): Promise<ValidZohoToken | null> {
	if (!tokens) return null;

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain ?? undefined;

	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope,
			user_email: tokens.user_email ?? null
		});
	}

	return { accessToken, apiDomain, tokens };
}

/**
 * Resolve a valid access token for the primary Zoho connection (CRM, Books,
 * Cliq, WorkDrive, Sign, Projects). Refreshes and persists if expired.
 * Returns `null` if no Zoho token is configured.
 */
export async function ensureValidZohoToken(): Promise<ValidZohoToken | null> {
	return ensureFresh(await getZohoTokens());
}

/**
 * Resolve a valid access token for a specific Zoho user (e.g. to read that
 * user's private mailbox). Refreshes and persists if expired. Returns `null`
 * if that user has no stored token.
 */
export async function ensureValidZohoTokenByUserId(
	userId: string
): Promise<ValidZohoToken | null> {
	return ensureFresh(await getZohoTokenByUserId(userId));
}
