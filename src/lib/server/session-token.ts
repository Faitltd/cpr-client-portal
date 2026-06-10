import { randomBytes } from 'crypto';

/**
 * 256-bit cryptographically random session token. Session tokens are bearer
 * credentials looked up in Supabase, so they must be unguessable — never
 * derive them from timestamps or Math.random().
 */
export function generateSessionToken(): string {
	return randomBytes(32).toString('hex');
}
