import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false }
});

export interface Client {
	id: string;
	zoho_contact_id: string;
	email: string;
	first_name?: string | null;
	last_name?: string | null;
	full_name?: string | null;
	company?: string | null;
	phone?: string | null;
}

export interface ClientAuth {
	id: string;
	email: string;
	password_hash: string | null;
}

export interface ClientSessionRecord {
	session_token: string;
	client_id: string;
	expires_at: string;
	ip_address?: string | null;
	user_agent?: string | null;
}

export interface ClientSession extends ClientSessionRecord {
	client: Client;
}

export interface ZohoTokens {
	id: string;
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
	scope?: string | null;
}


/**
 * Store or update client record
 */
export async function upsertClient(clientData: Omit<Client, 'id'>): Promise<Client> {
	const insertData = {
		zoho_contact_id: clientData.zoho_contact_id,
		email: clientData.email.toLowerCase(),
		first_name: clientData.first_name ?? null,
		last_name: clientData.last_name ?? null,
		company: clientData.company ?? null,
		phone: clientData.phone ?? null,
		updated_at: new Date().toISOString()
	};

	const { data, error } = await supabase
		.from('clients')
		.upsert([insertData], { onConflict: 'zoho_contact_id', defaultToNull: false })
		.select('id, zoho_contact_id, email, first_name, last_name, full_name, company, phone')
		.single();

	if (error) throw new Error(`Client upsert failed: ${error.message}`);
	return data as Client;
}

/**
 * Fetch client auth details by id
 */
export async function getClientAuthById(clientId: string): Promise<ClientAuth | null> {
	const { data, error } = await supabase
		.from('clients')
		.select('id, email, password_hash')
		.eq('id', clientId)
		.single();

	if (error || !data) return null;
	return data as ClientAuth;
}

/**
 * Fetch client auth details by email
 */
export async function getClientAuthByEmail(email: string): Promise<ClientAuth | null> {
	const { data, error } = await supabase
		.from('clients')
		.select('id, email, password_hash')
		.ilike('email', email)
		.single();

	if (error || !data) return null;
	return data as ClientAuth;
}

/**
 * Update client password hash
 */
export async function setClientPassword(clientId: string, passwordHash: string): Promise<void> {
	const { error } = await supabase
		.from('clients')
		.update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
		.eq('id', clientId);

	if (error) throw new Error(`Password update failed: ${error.message}`);
}

/**
 * Create a new client session
 */
export async function createSession(sessionData: ClientSessionRecord): Promise<void> {
	const { error } = await supabase
		.from('client_sessions')
		.insert(sessionData);

	if (error) throw new Error(`Session create failed: ${error.message}`);
}

/**
 * Get session by session token with client data
 */
export async function getSession(sessionToken: string): Promise<ClientSession | null> {
	const { data, error } = await supabase
		.from('client_sessions')
		.select(
			`session_token,
			 client_id,
			 expires_at,
			 clients (
				id,
				zoho_contact_id,
				email,
				first_name,
				last_name,
				full_name,
				company,
				phone
			 )`
		)
		.eq('session_token', sessionToken)
		.single();

	if (error || !data || !data.clients) return null;

	const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
	if (!client) return null;

	return {
		session_token: data.session_token,
		client_id: data.client_id,
		expires_at: data.expires_at,
		client: client as Client
	};
}

/**
 * Delete session (logout)
 */
export async function deleteSession(sessionToken: string): Promise<void> {
	await supabase.from('client_sessions').delete().eq('session_token', sessionToken);
}



/**
 * Fetch latest Zoho tokens
 */
export async function getZohoTokens(): Promise<ZohoTokens | null> {
	const { data, error } = await supabase
		.from('zoho_tokens')
		.select('id, user_id, access_token, refresh_token, expires_at, scope')
		.order('updated_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error || !data) return null;
	return data as ZohoTokens;
}

/**
 * Store or update Zoho tokens (single row)
 */
export async function upsertZohoTokens(tokens: Omit<ZohoTokens, 'id'>): Promise<ZohoTokens> {
	const existing = await getZohoTokens();
	const userId = tokens.user_id || existing?.user_id;

	if (!userId) {
		throw new Error('Zoho token insert failed: missing user_id');
	}

	if (existing?.id) {
		const { data, error } = await supabase
			.from('zoho_tokens')
			.update({
				user_id: userId,
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_at: tokens.expires_at,
				scope: tokens.scope ?? existing.scope,
				updated_at: new Date().toISOString()
			})
			.eq('id', existing.id)
			.select()
			.single();

		if (error) throw new Error(`Zoho token update failed: ${error.message}`);
		return data as ZohoTokens;
	}

	const { data, error } = await supabase
		.from('zoho_tokens')
		.insert({
			user_id: userId,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: tokens.expires_at,
			scope: tokens.scope ?? null,
			updated_at: new Date().toISOString()
		})
		.select()
		.single();

	if (error) throw new Error(`Zoho token insert failed: ${error.message}`);
	return data as ZohoTokens;
}

/**
 * List clients for admin management
 */
export async function listClients(): Promise<Client[]> {
	const { data, error } = await supabase
		.from('clients')
		.select('id, zoho_contact_id, email, first_name, last_name, full_name, company, phone')
		.order('full_name', { ascending: true, nullsFirst: false })
		.order('email', { ascending: true });

	if (error) throw new Error(`Client list failed: ${error.message}`);
	return (data as Client[]) || [];
}

/**
 * Clear all clients (and cascading related rows) before a full resync.
 */
export async function clearClients(): Promise<void> {
	const { error } = await supabase.from('clients').delete().neq('id', '');
	if (error) throw new Error(`Client clear failed: ${error.message}`);
}
