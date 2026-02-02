import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// TypeScript Interfaces for Supabase Tables
// ============================================================================

export interface ZohoToken {
	id: string;
	user_id: string;
	access_token: string;
	refresh_token: string;
	token_type: string;
	expires_at: string;
	scope: string | null;
	created_at: string;
	updated_at: string;
}

export interface Client {
	id: string;
	zoho_contact_id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	full_name: string;
	phone: string | null;
	company: string | null;
	address_street: string | null;
	address_city: string | null;
	address_state: string | null;
	address_zip: string | null;
	portal_access_enabled: boolean;
	last_login_at: string | null;
	zoho_data: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

export interface Project {
	id: string;
	zoho_deal_id: string;
	client_id: string;
	name: string;
	stage: string | null;
	status: string;
	amount: number | null;
	start_date: string | null;
	expected_completion: string | null;
	actual_completion: string | null;
	description: string | null;
	zoho_data: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

export interface ProjectDocument {
	id: string;
	project_id: string;
	name: string;
	file_path: string;
	file_type: string | null;
	file_size: number | null;
	category: string;
	uploaded_by: string | null;
	zoho_attachment_id: string | null;
	created_at: string;
}

export interface ClientSession {
	id: string;
	client_id: string;
	session_token: string;
	expires_at: string;
	ip_address: string | null;
	user_agent: string | null;
	created_at: string;
}

// ============================================================================
// Database Helper Functions
// ============================================================================

// Zoho Tokens
export async function getZohoToken(userId: string): Promise<ZohoToken | null> {
	const { data, error } = await supabase
		.from('zoho_tokens')
		.select('*')
		.eq('user_id', userId)
		.single();
	if (error) return null;
	return data;
}

export async function upsertZohoToken(token: Partial<ZohoToken> & { user_id: string }): Promise<ZohoToken | null> {
	const { data, error } = await supabase
		.from('zoho_tokens')
		.upsert(token, { onConflict: 'user_id' })
		.select()
		.single();
	if (error) {
		console.error('Error upserting Zoho token:', error);
		return null;
	}
	return data;
}

// Clients
export async function getClientByEmail(email: string): Promise<Client | null> {
	const { data, error } = await supabase
		.from('clients')
		.select('*')
		.eq('email', email)
		.single();
	if (error) return null;
	return data;
}

export async function getClientByZohoId(zohoContactId: string): Promise<Client | null> {
	const { data, error } = await supabase
		.from('clients')
		.select('*')
		.eq('zoho_contact_id', zohoContactId)
		.single();
	if (error) return null;
	return data;
}

export async function upsertClient(client: Partial<Client> & { zoho_contact_id: string; email: string }): Promise<Client | null> {
	const { data, error } = await supabase
		.from('clients')
		.upsert(client, { onConflict: 'zoho_contact_id' })
		.select()
		.single();
	if (error) {
		console.error('Error upserting client:', error);
		return null;
	}
	return data;
}

// Projects
export async function getProjectsByClientId(clientId: string): Promise<Project[]> {
	const { data, error } = await supabase
		.from('projects')
		.select('*')
		.eq('client_id', clientId)
		.order('created_at', { ascending: false });
	if (error) return [];
	return data || [];
}

export async function getProjectByZohoId(zohoDealId: string): Promise<Project | null> {
	const { data, error } = await supabase
		.from('projects')
		.select('*')
		.eq('zoho_deal_id', zohoDealId)
		.single();
	if (error) return null;
	return data;
}

// Client Sessions
export async function createClientSession(clientId: string, sessionToken: string, expiresAt: Date, ipAddress?: string, userAgent?: string): Promise<ClientSession | null> {
	const { data, error } = await supabase
		.from('client_sessions')
		.insert({
			client_id: clientId,
			session_token: sessionToken,
			expires_at: expiresAt.toISOString(),
			ip_address: ipAddress || null,
			user_agent: userAgent || null
		})
		.select()
		.single();
	if (error) {
		console.error('Error creating client session:', error);
		return null;
	}
	return data;
}

export async function getClientSession(sessionToken: string): Promise<(ClientSession & { client: Client }) | null> {
	const { data, error } = await supabase
		.from('client_sessions')
		.select('*, client:clients(*)')
		.eq('session_token', sessionToken)
		.gt('expires_at', new Date().toISOString())
		.single();
	if (error) return null;
	return data as (ClientSession & { client: Client });
}

export async function deleteClientSession(sessionToken: string): Promise<boolean> {
	const { error } = await supabase
		.from('client_sessions')
		.delete()
		.eq('session_token', sessionToken);
	return !error;
}
