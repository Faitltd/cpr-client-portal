import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$env/static/private';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
	throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Portal session schema in Supabase:
 * 
 * Table: portal_sessions
 * - id: uuid (primary key)
 * - user_id: text (Zoho Contact ID)
 * - email: text
 * - name: text
 * - zoho_contact_id: text (indexed)
 * - access_token: text (encrypted)
 * - refresh_token: text (encrypted)
 * - expires_at: timestamp
 * - created_at: timestamp
 * - updated_at: timestamp
 * 
 * Table: portal_users
 * - id: uuid (primary key)
 * - zoho_contact_id: text (unique, indexed)
 * - email: text (unique)
 * - name: text
 * - company: text
 * - phone: text
 * - is_active: boolean
 * - last_login: timestamp
 * - created_at: timestamp
 */

export interface PortalSession {
	id: string;
	user_id: string;
	email: string;
	name: string;
	zoho_contact_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
}

export interface PortalUser {
	id: string;
	zoho_contact_id: string;
	email: string;
	name: string;
	company?: string;
	phone?: string;
	is_active: boolean;
	last_login: string;
}

/**
 * Store or update portal session
 */
export async function upsertSession(sessionData: Omit<PortalSession, 'id'>): Promise<PortalSession> {
	const { data, error } = await supabase
		.from('portal_sessions')
		.upsert(
			{ ...sessionData, updated_at: new Date().toISOString() },
			{ onConflict: 'zoho_contact_id' }
		)
		.select()
		.single();

	if (error) throw new Error(`Session upsert failed: ${error.message}`);
	return data;
}

/**
 * Get session by user ID
 */
export async function getSession(userId: string): Promise<PortalSession | null> {
	const { data, error } = await supabase
		.from('portal_sessions')
		.select('*')
		.eq('user_id', userId)
		.single();

	if (error) return null;
	return data;
}

/**
 * Delete session (logout)
 */
export async function deleteSession(userId: string): Promise<void> {
	await supabase.from('portal_sessions').delete().eq('user_id', userId);
}

/**
 * Update portal user login timestamp
 */
export async function updateUserLogin(zohoContactId: string): Promise<void> {
	await supabase
		.from('portal_users')
		.update({ last_login: new Date().toISOString() })
		.eq('zoho_contact_id', zohoContactId);
}