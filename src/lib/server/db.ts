import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
 * - updated_at: timestamp
 */
