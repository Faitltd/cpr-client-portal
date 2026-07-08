import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import ws from 'ws';
import {
	findNormalizedEmailMatch,
	normalizeEmailAddress,
	normalizeStoredPasswordHash
} from './auth-normalization';

let supabaseClient: SupabaseClient<any, any, any> | null = null;

type EmailRecord = { email: string | null | undefined };

function getSupabase() {
	if (supabaseClient) return supabaseClient;

	const SUPABASE_URL = env.SUPABASE_URL;
	const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error('Missing Supabase environment variables');
	}

	supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false },
		// Node 20 lacks a global WebSocket. Supply `ws` so the realtime client
		// (which Supabase initializes eagerly even when we don't use it) can
		// construct without throwing.
		realtime: { transport: ws as unknown as typeof WebSocket }
	});
	return supabaseClient;
}

function normalizeAuthRecord<T extends EmailRecord>(record: T): T {
	if (!record) return record;

	return {
		...record,
		email: normalizeEmailAddress(record.email),
		...(Object.prototype.hasOwnProperty.call(record, 'password_hash')
			? {
					password_hash: normalizeStoredPasswordHash(
						(record as T & { password_hash?: string | null }).password_hash ?? null
					)
				}
			: {})
	} as T;
}

function buildEmailContainsPattern(email: string): string {
	return `%${email.replace(/[\\%_]/g, '\\$&')}%`;
}

async function findRecordByNormalizedEmail<T extends EmailRecord>(
	table: string,
	select: string,
	email: string
): Promise<T | null> {
	const normalizedEmail = normalizeEmailAddress(email);
	if (!normalizedEmail) return null;

	let exactLookupError: Error | null = null;
	const exactResult = await getSupabase()
		.from(table)
		.select(select)
		.eq('email', normalizedEmail)
		.maybeSingle();

	if (exactResult.error) {
		exactLookupError = new Error(`${table} email lookup failed: ${exactResult.error.message}`);
	} else if (exactResult.data) {
		return normalizeAuthRecord(exactResult.data as unknown as T);
	}

	const candidateResult = await getSupabase()
		.from(table)
		.select(select)
		.ilike('email', buildEmailContainsPattern(normalizedEmail));

	if (candidateResult.error) {
		throw new Error(`${table} email lookup failed: ${candidateResult.error.message}`);
	}

	let candidateMatch: T | null = null;
	try {
		candidateMatch = findNormalizedEmailMatch(
			(candidateResult.data ?? []) as unknown as T[],
			normalizedEmail
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${table} email lookup failed: ${message}`);
	}

	if (candidateMatch) {
		return normalizeAuthRecord(candidateMatch);
	}

	if (exactLookupError) {
		throw exactLookupError;
	}

	return null;
}

export const supabase = new Proxy({} as SupabaseClient<any, any, any>, {
	get(_target, prop) {
		const client = getSupabase() as any;
		const value = client[prop];
		if (typeof value === 'function') {
			return value.bind(client);
		}
		return value;
	}
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
	portal_active?: boolean | null;
	/** Explicit Zoho Books customer id — used when the client's login email
	 * doesn't match their Books customer email. Takes precedence over the
	 * email-based Books lookup. */
	books_customer_id?: string | null;
}

export interface ClientAuth {
	id: string;
	email: string;
	password_hash: string | null;
	portal_active?: boolean | null;
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

export interface TradePartner {
	id: string;
	zoho_trade_partner_id: string;
	email: string;
	name?: string | null;
	company?: string | null;
	phone?: string | null;
}

export interface TradePartnerAuth {
	id: string;
	email: string;
	password_hash: string | null;
	phone?: string | null;
}

export interface TradeSessionRecord {
	session_token: string;
	trade_partner_id: string;
	expires_at: string;
	ip_address?: string | null;
	user_agent?: string | null;
}

export interface TradeSession extends TradeSessionRecord {
	trade_partner: TradePartner;
}

export interface ZohoTokens {
	id: string;
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
	scope?: string | null;
	api_domain?: string | null;
	user_email?: string | null;
	is_primary?: boolean;
}


/**
 * Store or update client record
 */
export async function upsertClient(clientData: Omit<Client, 'id'>): Promise<Client> {
	const insertData = {
		zoho_contact_id: clientData.zoho_contact_id,
		email: normalizeEmailAddress(clientData.email),
		first_name: clientData.first_name ?? null,
		last_name: clientData.last_name ?? null,
		company: clientData.company ?? null,
		phone: clientData.phone ?? null,
		portal_active: clientData.portal_active ?? false,
		updated_at: new Date().toISOString()
	};

	const { data, error } = await getSupabase()
		.from('clients')
		.upsert([insertData], { onConflict: 'zoho_contact_id', defaultToNull: false })
		.select('id, zoho_contact_id, email, first_name, last_name, full_name, company, phone, portal_active')
		.single();

	if (error) throw new Error(`Client upsert failed: ${error.message}`);
	return data as Client;
}

/**
 * Fetch client auth details by id
 */
export async function getClientAuthById(clientId: string): Promise<ClientAuth | null> {
	const { data, error } = await getSupabase()
		.from('clients')
		.select('id, email, password_hash, portal_active')
		.eq('id', clientId)
		.single();

	if (error || !data) return null;
	return data as ClientAuth;
}

/**
 * Fetch full client profile by id
 */
export async function getClientById(clientId: string): Promise<Client | null> {
	const { data, error } = await getSupabase()
		.from('clients')
		.select('id, zoho_contact_id, email, first_name, last_name, full_name, company, phone, portal_active')
		.eq('id', clientId)
		.single();

	if (error || !data) return null;
	return data as Client;
}

/**
 * Fetch full client profile by email
 */
export async function getClientByEmail(email: string): Promise<Client | null> {
	return findRecordByNormalizedEmail<Client>(
		'clients',
		'id, zoho_contact_id, email, first_name, last_name, full_name, company, phone, portal_active',
		email
	);
}

/**
 * Fetch client auth details by email
 */
export async function getClientAuthByEmail(email: string): Promise<ClientAuth | null> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return null;

	const start = Date.now();
	const { data, error } = await getSupabase()
		.from('clients')
		.select('id, email, password_hash, portal_active')
		.eq('email', normalized)
		.maybeSingle();

	console.info('[client-auth] db lookup', { ms: Date.now() - start, hit: !!data });

	if (error) throw new Error(`Client lookup failed: ${error.message}`);
	return data ? normalizeAuthRecord(data as ClientAuth) : null;
}

/**
 * Update client password hash
 */
export async function setClientPassword(clientId: string, passwordHash: string): Promise<void> {
	const { error } = await getSupabase()
		.from('clients')
		.update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
		.eq('id', clientId);

	if (error) throw new Error(`Password update failed: ${error.message}`);
}

/**
 * Create a new client session
 */
export async function createSession(sessionData: ClientSessionRecord): Promise<void> {
	const { error } = await getSupabase()
		.from('client_sessions')
		.insert(sessionData);

	if (error) throw new Error(`Session create failed: ${error.message}`);
}

/**
 * Get session by session token with client data
 */
export async function getSession(sessionToken: string): Promise<ClientSession | null> {
	const nowIso = new Date().toISOString();
	const { data, error } = await getSupabase()
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
				phone,
				books_customer_id
			 )`
		)
		.eq('session_token', sessionToken)
		.gt('expires_at', nowIso)
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

/** Persist the resolved Zoho Books customer id on a client (auto-heal). */
export async function setClientBooksCustomerId(
	clientId: string,
	booksCustomerId: string
): Promise<void> {
	const { error } = await getSupabase()
		.from('clients')
		.update({ books_customer_id: booksCustomerId })
		.eq('id', clientId);
	if (error) console.warn('[db] setClientBooksCustomerId failed:', error.message);
}

/**
 * Delete session (logout)
 */
export async function deleteSession(sessionToken: string): Promise<void> {
	await getSupabase().from('client_sessions').delete().eq('session_token', sessionToken);
}

/**
 * Fetch trade partner auth details by email
 */
export async function getTradePartnerAuthByEmail(email: string): Promise<TradePartnerAuth | null> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return null;

	const start = Date.now();
	const { data, error } = await getSupabase()
		.from('trade_partners')
		.select('id, email, password_hash, phone')
		.eq('email', normalized)
		.maybeSingle();

	console.info('[trade-auth] db lookup', { ms: Date.now() - start, hit: !!data });

	if (error) throw new Error(`Trade partner lookup failed: ${error.message}`);
	return data ? normalizeAuthRecord(data as TradePartnerAuth) : null;
}

/**
 * Store or update trade partner record from Zoho
 */
export async function upsertTradePartner(tradePartner: Omit<TradePartner, 'id'>): Promise<TradePartner> {
	const insertData = {
		zoho_trade_partner_id: tradePartner.zoho_trade_partner_id,
		email: normalizeEmailAddress(tradePartner.email),
		name: tradePartner.name ?? null,
		company: tradePartner.company ?? null,
		phone: tradePartner.phone ?? null,
		updated_at: new Date().toISOString()
	};

	const { data, error } = await getSupabase()
		.from('trade_partners')
		.upsert([insertData], { onConflict: 'zoho_trade_partner_id', defaultToNull: false })
		.select('id, zoho_trade_partner_id, email, name, company, phone')
		.single();

	if (!error) return data as TradePartner;

	// If email already exists, attach Zoho ID to the existing record.
	if (error.message.includes('trade_partners_email_key')) {
			const { data: existing, error: fetchError } = await getSupabase()
				.from('trade_partners')
				.select('id')
				.eq('email', insertData.email)
				.single();

		if (fetchError || !existing) {
			throw new Error(`Trade partner lookup failed: ${fetchError?.message || 'not found'}`);
		}

			const { data: updated, error: updateError } = await getSupabase()
				.from('trade_partners')
				.update({
					zoho_trade_partner_id: insertData.zoho_trade_partner_id,
					name: insertData.name,
				company: insertData.company,
				phone: insertData.phone,
				updated_at: insertData.updated_at
			})
			.eq('id', existing.id)
			.select('id, zoho_trade_partner_id, email, name, company, phone')
			.single();

		if (updateError) {
			throw new Error(`Trade partner update failed: ${updateError.message}`);
		}

		return updated as TradePartner;
	}

	throw new Error(`Trade partner upsert failed: ${error.message}`);
}

/**
 * Create a new trade partner session
 */
export async function createTradeSession(sessionData: TradeSessionRecord): Promise<void> {
	const { error } = await getSupabase()
		.from('trade_sessions')
		.insert(sessionData);

	if (error) throw new Error(`Trade session create failed: ${error.message}`);
}

/**
 * Get trade partner session by session token
 */
export async function getTradeSession(sessionToken: string): Promise<TradeSession | null> {
	const nowIso = new Date().toISOString();
	const { data, error } = await getSupabase()
		.from('trade_sessions')
		.select(
			`session_token,
			 trade_partner_id,
			 expires_at,
			 trade_partners (
				id,
				zoho_trade_partner_id,
				email,
				name,
				company,
				phone
			 )`
		)
		.eq('session_token', sessionToken)
		.gt('expires_at', nowIso)
		.single();

	if (error || !data || !data.trade_partners) return null;

	const trade_partner = Array.isArray(data.trade_partners) ? data.trade_partners[0] : data.trade_partners;
	if (!trade_partner) return null;

	return {
		session_token: data.session_token,
		trade_partner_id: data.trade_partner_id,
		expires_at: data.expires_at,
		trade_partner: trade_partner as TradePartner
	};
}

/**
 * Delete trade partner session (logout)
 */
export async function deleteTradeSession(sessionToken: string): Promise<void> {
	await getSupabase().from('trade_sessions').delete().eq('session_token', sessionToken);
}

/**
 * Update trade partner password hash
 */
export async function setTradePartnerPassword(tradePartnerId: string, passwordHash: string): Promise<void> {
	const { error } = await getSupabase()
		.from('trade_partners')
		.update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
		.eq('id', tradePartnerId);

	if (error) throw new Error(`Trade partner update failed: ${error.message}`);
}

export type TradePartnerListItem = { id: string; email: string; name: string | null };

export async function listTradePartnersForAdmin(): Promise<TradePartnerListItem[]> {
	const { data, error } = await getSupabase()
		.from('trade_partners')
		.select('id, email, name')
		.order('name', { ascending: true, nullsFirst: false })
		.order('email', { ascending: true });

	if (error) throw new Error(`Trade partner list failed: ${error.message}`);
	return (data as TradePartnerListItem[]) || [];
}

// ---------------------------------------------------------------------------
// Designers (role: designer) — reuses the portal_session cookie model.
// Sessions live in a dedicated table so the existing client flow is untouched.
// ---------------------------------------------------------------------------

export interface Designer {
	id: string;
	email: string;
	name?: string | null;
	active?: boolean | null;
}

export interface DesignerAuth {
	id: string;
	email: string;
	password_hash: string | null;
	active?: boolean | null;
}

export interface DesignerSessionRecord {
	session_token: string;
	designer_id: string;
	expires_at: string;
	ip_address?: string | null;
	user_agent?: string | null;
}

export interface DesignerSession extends DesignerSessionRecord {
	designer: Designer;
}

export async function getDesignerAuthByEmail(email: string): Promise<DesignerAuth | null> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return null;

	const start = Date.now();
	const { data, error } = await getSupabase()
		.from('designers')
		.select('id, email, password_hash, active')
		.eq('email', normalized)
		.maybeSingle();

	console.info('[designer-auth] db lookup', { ms: Date.now() - start, hit: !!data });

	if (error) throw new Error(`Designer lookup failed: ${error.message}`);
	return data ? normalizeAuthRecord(data as DesignerAuth) : null;
}

export async function getDesignerById(id: string): Promise<Designer | null> {
	const { data, error } = await getSupabase()
		.from('designers')
		.select('id, email, name, active')
		.eq('id', id)
		.single();

	if (error || !data) return null;
	return data as Designer;
}

export async function upsertDesigner(
	input: { email: string; name?: string | null; active?: boolean }
): Promise<Designer> {
	const row = {
		email: normalizeEmailAddress(input.email),
		name: input.name ?? null,
		active: input.active ?? true,
		updated_at: new Date().toISOString()
	};

	const { data, error } = await getSupabase()
		.from('designers')
		.upsert([row], { onConflict: 'email', defaultToNull: false })
		.select('id, email, name, active')
		.single();

	if (error) throw new Error(`Designer upsert failed: ${error.message}`);
	return data as Designer;
}

export async function setDesignerPassword(designerId: string, passwordHash: string): Promise<void> {
	const { error } = await getSupabase()
		.from('designers')
		.update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
		.eq('id', designerId);

	if (error) throw new Error(`Designer password update failed: ${error.message}`);
}

export async function createDesignerSession(sessionData: DesignerSessionRecord): Promise<void> {
	const { error } = await getSupabase().from('designer_sessions').insert(sessionData);
	if (error) throw new Error(`Designer session create failed: ${error.message}`);
}

export async function getDesignerSession(sessionToken: string): Promise<DesignerSession | null> {
	const nowIso = new Date().toISOString();
	const { data, error } = await getSupabase()
		.from('designer_sessions')
		.select(
			`session_token,
			 designer_id,
			 expires_at,
			 designers (
				id,
				email,
				name,
				active
			 )`
		)
		.eq('session_token', sessionToken)
		.gt('expires_at', nowIso)
		.single();

	if (error || !data || !data.designers) return null;

	const designer = Array.isArray(data.designers) ? data.designers[0] : data.designers;
	if (!designer) return null;
	if (designer.active === false) return null;

	return {
		session_token: data.session_token,
		designer_id: data.designer_id,
		expires_at: data.expires_at,
		designer: designer as Designer
	};
}

export async function deleteDesignerSession(sessionToken: string): Promise<void> {
	await getSupabase().from('designer_sessions').delete().eq('session_token', sessionToken);
}

export type DesignerListItem = { id: string; email: string; name: string | null; active: boolean | null };

export async function listDesigners(): Promise<DesignerListItem[]> {
	const { data, error } = await getSupabase()
		.from('designers')
		.select('id, email, name, active')
		.order('name', { ascending: true, nullsFirst: false })
		.order('email', { ascending: true });

	if (error) throw new Error(`Designer list failed: ${error.message}`);
	return (data as DesignerListItem[]) || [];
}

// ---------------------------------------------------------------------------
// Admin users (role: admin) — per-user accounts with their own hashed password.
// Coexists with the env-based PORTAL_ADMIN_EMAIL(S)/PORTAL_ADMIN_PASSWORD login.
// ---------------------------------------------------------------------------

export interface AdminUser {
	id: string;
	email: string;
	name?: string | null;
	active?: boolean | null;
}

export interface AdminUserAuth {
	id: string;
	email: string;
	password_hash: string | null;
	active?: boolean | null;
}

export async function getAdminUserAuthByEmail(email: string): Promise<AdminUserAuth | null> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return null;

	const { data, error } = await getSupabase()
		.from('admin_users')
		.select('id, email, password_hash, active')
		.eq('email', normalized)
		.maybeSingle();

	if (error) throw new Error(`Admin user lookup failed: ${error.message}`);
	return data ? normalizeAuthRecord(data as AdminUserAuth) : null;
}

export async function upsertAdminUser(
	input: { email: string; name?: string | null; active?: boolean }
): Promise<AdminUser> {
	const row = {
		email: normalizeEmailAddress(input.email),
		name: input.name ?? null,
		active: input.active ?? true,
		updated_at: new Date().toISOString()
	};

	const { data, error } = await getSupabase()
		.from('admin_users')
		.upsert([row], { onConflict: 'email', defaultToNull: false })
		.select('id, email, name, active')
		.single();

	if (error) throw new Error(`Admin user upsert failed: ${error.message}`);
	return data as AdminUser;
}

export async function setAdminUserPassword(adminUserId: string, passwordHash: string): Promise<void> {
	const { error } = await getSupabase()
		.from('admin_users')
		.update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
		.eq('id', adminUserId);

	if (error) throw new Error(`Admin user password update failed: ${error.message}`);
}

export type AdminUserListItem = { id: string; email: string; name: string | null; active: boolean | null };

export async function listAdminUsers(): Promise<AdminUserListItem[]> {
	const { data, error } = await getSupabase()
		.from('admin_users')
		.select('id, email, name, active')
		.order('name', { ascending: true, nullsFirst: false })
		.order('email', { ascending: true });

	if (error) throw new Error(`Admin user list failed: ${error.message}`);
	return (data as AdminUserListItem[]) || [];
}


/**
 * Fetch latest Zoho tokens
 */
const TOKEN_SELECT =
	'id, user_id, user_email, is_primary, access_token, refresh_token, expires_at, scope';

/**
 * Get the primary Zoho token — used for CRM, Cliq, Books, and any operation
 * that doesn't need a specific user's mailbox. Falls back to the most recent
 * row if no row is flagged primary.
 */
export async function getZohoTokens(): Promise<ZohoTokens | null> {
	const supabase = getSupabase();
	const primary = await supabase
		.from('zoho_tokens')
		.select(TOKEN_SELECT)
		.eq('is_primary', true)
		.limit(1)
		.maybeSingle();
	if (primary.data) return primary.data as ZohoTokens;

	const fallback = await supabase
		.from('zoho_tokens')
		.select(TOKEN_SELECT)
		.order('updated_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (fallback.error || !fallback.data) return null;
	return fallback.data as ZohoTokens;
}

/**
 * Get the token belonging to a specific Zoho user_id. Used to fetch email
 * bodies that are private to that user.
 */
export async function getZohoTokenByUserId(userId: string): Promise<ZohoTokens | null> {
	const { data, error } = await getSupabase()
		.from('zoho_tokens')
		.select(TOKEN_SELECT)
		.eq('user_id', userId)
		.maybeSingle();
	if (error || !data) return null;
	return data as ZohoTokens;
}

/**
 * List all connected Zoho users (one token per user).
 */
export async function listZohoTokens(): Promise<ZohoTokens[]> {
	const { data, error } = await getSupabase()
		.from('zoho_tokens')
		.select(TOKEN_SELECT)
		.order('is_primary', { ascending: false })
		.order('updated_at', { ascending: false });
	if (error || !data) return [];
	return data as ZohoTokens[];
}

/**
 * Store or update Zoho tokens (single row)
 */
/**
 * Multi-user upsert keyed by Zoho user_id. Preserves existing rows for OTHER
 * users. Fields not passed in keep their existing values. The first row ever
 * inserted is automatically the primary; subsequent inserts are non-primary
 * unless explicitly promoted.
 */
export async function upsertZohoTokens(
	tokens: Omit<ZohoTokens, 'id' | 'is_primary'> & { is_primary?: boolean }
): Promise<ZohoTokens> {
	const supabase = getSupabase();
	if (!tokens.user_id) {
		throw new Error('Zoho token insert failed: missing user_id');
	}

	const existingByUser = await supabase
		.from('zoho_tokens')
		.select(TOKEN_SELECT)
		.eq('user_id', tokens.user_id)
		.maybeSingle();

	if (existingByUser.data) {
		const existing = existingByUser.data as ZohoTokens;
		const { data, error } = await supabase
			.from('zoho_tokens')
			.update({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_at: tokens.expires_at,
				scope: tokens.scope ?? existing.scope,
				user_email: tokens.user_email ?? existing.user_email ?? null,
				...(tokens.is_primary !== undefined ? { is_primary: tokens.is_primary } : {}),
				updated_at: new Date().toISOString()
			})
			.eq('id', existing.id)
			.select(TOKEN_SELECT)
			.single();
		if (error) throw new Error(`Zoho token update failed: ${error.message}`);
		return data as ZohoTokens;
	}

	// First row ever? Auto-mark primary.
	const { count } = await supabase
		.from('zoho_tokens')
		.select('id', { count: 'exact', head: true });
	const isFirst = !count || count === 0;

	const { data, error } = await supabase
		.from('zoho_tokens')
		.insert({
			user_id: tokens.user_id,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: tokens.expires_at,
			scope: tokens.scope ?? null,
			user_email: tokens.user_email ?? null,
			is_primary: tokens.is_primary ?? isFirst,
			updated_at: new Date().toISOString()
		})
		.select(TOKEN_SELECT)
		.single();
	if (error) throw new Error(`Zoho token insert failed: ${error.message}`);
	return data as ZohoTokens;
}

/**
 * Delete a user's token by id. Used by the bot users management UI.
 */
export async function deleteZohoToken(tokenId: string): Promise<void> {
	const { error } = await getSupabase().from('zoho_tokens').delete().eq('id', tokenId);
	if (error) throw new Error(`Zoho token delete failed: ${error.message}`);
}

/**
 * Promote a specific row to primary. Demotes all others.
 */
export async function setPrimaryZohoToken(tokenId: string): Promise<void> {
	const supabase = getSupabase();
	const demote = await supabase.from('zoho_tokens').update({ is_primary: false }).neq('id', tokenId);
	if (demote.error) throw new Error(`demote failed: ${demote.error.message}`);
	const promote = await supabase
		.from('zoho_tokens')
		.update({ is_primary: true })
		.eq('id', tokenId);
	if (promote.error) throw new Error(`promote failed: ${promote.error.message}`);
}

/**
 * List clients for admin management
 */
export async function listClients(): Promise<Client[]> {
	const { data, error } = await getSupabase()
		.from('clients')
		.select(
			'id, zoho_contact_id, email, first_name, last_name, full_name, company, phone, portal_active'
		)
		.eq('portal_active', true)
		.order('full_name', { ascending: true, nullsFirst: false })
		.order('email', { ascending: true });

	if (error) throw new Error(`Client list failed: ${error.message}`);
	return (data as Client[]) || [];
}

/**
 * Clear all clients (and cascading related rows) before a full resync.
 */
export async function clearClients(): Promise<void> {
	const { error } = await getSupabase().from('clients').delete().not('id', 'is', null);
	if (error) throw new Error(`Client clear failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Daily Logs
// ---------------------------------------------------------------------------

export interface DailyLog {
	id: string;
	deal_id: string;
	trade_partner_id: string | null;
	log_date: string;
	hours_worked: number | null;
	work_completed: string | null;
	work_planned: string | null;
	issues_encountered: string | null;
	photo_ids: string[] | null;
	weather_delay: boolean;
	created_at: string;
	updated_at: string;
}

/**
 * Insert or update a trade partner's daily log for a given deal + date.
 * Unique constraint: (deal_id, trade_partner_id, log_date)
 */
export async function upsertDailyLog(
	log: Omit<DailyLog, 'id' | 'created_at' | 'updated_at'>
): Promise<DailyLog> {
	const { data, error } = await getSupabase()
		.from('daily_logs')
		.upsert([log], { onConflict: 'deal_id,trade_partner_id,log_date' })
		.select()
		.single();

	if (error) throw new Error(`Daily log upsert failed: ${error.message}`);
	return data as DailyLog;
}

/**
 * Fetch all daily logs for a deal, newest first. Admin use.
 */
export async function getDailyLogsForDeal(dealId: string): Promise<DailyLog[]> {
	const { data, error } = await getSupabase()
		.from('daily_logs')
		.select('*')
		.eq('deal_id', dealId)
		.order('log_date', { ascending: false });

	if (error) throw new Error(`Daily log fetch failed: ${error.message}`);
	return (data as DailyLog[]) || [];
}

/**
 * Fetch a trade partner's own daily logs for a deal, newest first.
 */
export async function getMyDailyLogsForDeal(
	dealId: string,
	tradePartnerId: string
): Promise<DailyLog[]> {
	const { data, error } = await getSupabase()
		.from('daily_logs')
		.select('*')
		.eq('deal_id', dealId)
		.eq('trade_partner_id', tradePartnerId)
		.order('log_date', { ascending: false });

	if (error) throw new Error(`Daily log fetch failed: ${error.message}`);
	return (data as DailyLog[]) || [];
}

// ---------------------------------------------------------------------------
// Comms Log
// ---------------------------------------------------------------------------

export interface CommsLogEntry {
	id: string;
	deal_id: string;
	direction: 'outbound' | 'inbound';
	channel: 'email' | 'phone' | 'text' | 'portal' | 'in_person';
	subject: string | null;
	summary: string | null;
	contacted_by: string | null;
	sla_target_hours: number;
	created_at: string;
}

/**
 * Record a client communication event.
 */
export async function logComm(
	entry: Omit<CommsLogEntry, 'id' | 'created_at'>
): Promise<CommsLogEntry> {
	const { data, error } = await getSupabase()
		.from('comms_log')
		.insert(entry)
		.select()
		.single();

	if (error) throw new Error(`Comm log insert failed: ${error.message}`);
	return data as CommsLogEntry;
}

/**
 * Fetch all comms for a deal, newest first.
 */
export async function getCommsForDeal(dealId: string): Promise<CommsLogEntry[]> {
	const { data, error } = await getSupabase()
		.from('comms_log')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Comms log fetch failed: ${error.message}`);
	return (data as CommsLogEntry[]) || [];
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export interface Approval {
	id: string;
	deal_id: string;
	title: string;
	description: string | null;
	category: 'selection' | 'change_order' | 'design' | 'schedule' | 'budget' | 'general';
	assigned_to: 'client' | 'admin';
	status: 'pending' | 'approved' | 'rejected' | 'deferred';
	priority: 'low' | 'normal' | 'high' | 'urgent';
	due_date: string | null;
	responded_at: string | null;
	response_note: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Create a new approval item for a deal.
 */
export async function createApproval(
	approval: Omit<Approval, 'id' | 'responded_at' | 'response_note' | 'created_at' | 'updated_at'>
): Promise<Approval> {
	const { data, error } = await getSupabase()
		.from('approvals')
		.insert(approval)
		.select()
		.single();

	if (error) throw new Error(`Approval create failed: ${error.message}`);
	return data as Approval;
}

/**
 * Fetch all approvals for a deal.
 */
export async function getApprovalsForDeal(dealId: string): Promise<Approval[]> {
	const { data, error } = await getSupabase()
		.from('approvals')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Approvals fetch failed: ${error.message}`);
	return (data as Approval[]) || [];
}

/**
 * Fetch only pending approvals for a deal, optionally filtered by assignee.
 */
export async function getPendingApprovalsForDeal(
	dealId: string,
	assignedTo?: 'client' | 'admin'
): Promise<Approval[]> {
	let query = getSupabase()
		.from('approvals')
		.select('*')
		.eq('deal_id', dealId)
		.eq('status', 'pending');

	if (assignedTo) query = query.eq('assigned_to', assignedTo);

	const { data, error } = await query.order('priority').order('due_date', { nullsFirst: false });

	if (error) throw new Error(`Pending approvals fetch failed: ${error.message}`);
	return (data as Approval[]) || [];
}

/**
 * Record a response to an approval item.
 */
export async function updateApprovalStatus(
	approvalId: string,
	status: Approval['status'],
	responseNote?: string
): Promise<Approval> {
	const { data, error } = await getSupabase()
		.from('approvals')
		.update({
			status,
			responded_at: new Date().toISOString(),
			response_note: responseNote ?? null,
			updated_at: new Date().toISOString()
		})
		.eq('id', approvalId)
		.select()
		.single();

	if (error) throw new Error(`Approval update failed: ${error.message}`);
	return data as Approval;
}

// ---------------------------------------------------------------------------
// Task Templates
// ---------------------------------------------------------------------------

export interface TaskTemplate {
	id: string;
	project_type: string;
	phase: string;
	task_name: string;
	trade: string | null;
	description: string | null;
	default_duration_days: number;
	dependency_key: string | null;
	requires_inspection: boolean;
	requires_client_decision: boolean;
	material_lead_time_days: number;
	sort_order: number;
	is_conditional: boolean;
	condition_key: string | null;
	condition_value: string | null;
	active: boolean;
	created_at: string;
}

/**
 * Fetch all active task templates for a project type, ordered by phase then sort_order.
 */
export async function getTaskTemplatesByProjectType(projectType: string): Promise<TaskTemplate[]> {
	const { data, error } = await getSupabase()
		.from('task_templates')
		.select('id, project_type, phase, task_name, trade, description, default_duration_days, dependency_key, requires_inspection, requires_client_decision, material_lead_time_days, sort_order, is_conditional, condition_key, condition_value, active, created_at')
		.eq('project_type', projectType)
		.eq('active', true)
		.order('phase')
		.order('sort_order');

	if (error) throw new Error(`Task templates fetch failed: ${error.message}`);
	return (data as TaskTemplate[]) || [];
}

/**
 * Fetch a single task template by id.
 */
export async function getTaskTemplateById(id: string): Promise<TaskTemplate | null> {
	const { data, error } = await getSupabase()
		.from('task_templates')
		.select('id, project_type, phase, task_name, trade, description, default_duration_days, dependency_key, requires_inspection, requires_client_decision, material_lead_time_days, sort_order, is_conditional, condition_key, condition_value, active, created_at')
		.eq('id', id)
		.single();

	if (error || !data) return null;
	return data as TaskTemplate;
}

/**
 * Create a new task template.
 */
export async function createTaskTemplate(
	data: Omit<TaskTemplate, 'id' | 'created_at'>
): Promise<TaskTemplate> {
	const { data: created, error } = await getSupabase()
		.from('task_templates')
		.insert(data)
		.select()
		.single();

	if (error) throw new Error(`Task template create failed: ${error.message}`);
	return created as TaskTemplate;
}

/**
 * Update an existing task template by id.
 */
export async function updateTaskTemplate(
	id: string,
	data: Partial<Omit<TaskTemplate, 'id' | 'created_at'>>
): Promise<TaskTemplate> {
	const { data: updated, error } = await getSupabase()
		.from('task_templates')
		.update(data)
		.eq('id', id)
		.select()
		.single();

	if (error) throw new Error(`Task template update failed: ${error.message}`);
	return updated as TaskTemplate;
}

/**
 * Soft-delete a task template by setting active = false.
 */
export async function deleteTaskTemplate(id: string): Promise<void> {
	const { error } = await getSupabase()
		.from('task_templates')
		.update({ active: false })
		.eq('id', id);

	if (error) throw new Error(`Task template delete failed: ${error.message}`);
}

/**
 * Get sorted unique project types from active task templates.
 */
export async function getDistinctProjectTypes(): Promise<string[]> {
	const { data, error } = await getSupabase()
		.from('task_templates')
		.select('project_type')
		.eq('active', true);

	if (error) throw new Error(`Project types fetch failed: ${error.message}`);
	const unique = [...new Set((data || []).map((r: { project_type: string }) => r.project_type))];
	return unique.sort();
}

// ---------------------------------------------------------------------------
// Scope Definitions
// ---------------------------------------------------------------------------

export interface ScopeDefinition {
	id: string;
	deal_id: string;
	project_type: string;
	areas: Array<{ name: string; sqft?: number }>;
	included_items: string[];
	excluded_items: string[];
	selections_needed: string[];
	permit_required: boolean;
	long_lead_items: string[];
	special_conditions: Record<string, boolean | string>;
	trade_notes: string | null;
	status: 'draft' | 'reviewed' | 'approved' | 'generated';
	created_at: string;
	updated_at: string;
}

/**
 * Fetch the scope definition for a deal.
 */
export async function getScopeDefinition(dealId: string): Promise<ScopeDefinition | null> {
	const { data, error } = await getSupabase()
		.from('scope_definitions')
		.select('*')
		.eq('deal_id', dealId)
		.maybeSingle();

	if (error) throw new Error(`Scope definition fetch failed: ${error.message}`);
	return data as ScopeDefinition | null;
}

/**
 * Insert or update a scope definition for a deal.
 */
export async function upsertScopeDefinition(
	data: Omit<ScopeDefinition, 'id' | 'created_at' | 'updated_at'>
): Promise<ScopeDefinition> {
	const insertData = {
		...data,
		updated_at: new Date().toISOString()
	};

	const { data: upserted, error } = await getSupabase()
		.from('scope_definitions')
		.upsert([insertData], { onConflict: 'deal_id' })
		.select()
		.single();

	if (error) throw new Error(`Scope definition upsert failed: ${error.message}`);
	return upserted as ScopeDefinition;
}

/**
 * Update the status of a scope definition by deal id.
 */
export async function updateScopeStatus(
	dealId: string,
	status: ScopeDefinition['status']
): Promise<ScopeDefinition> {
	const { data, error } = await getSupabase()
		.from('scope_definitions')
		.update({ status, updated_at: new Date().toISOString() })
		.eq('deal_id', dealId)
		.select()
		.single();

	if (error) throw new Error(`Scope status update failed: ${error.message}`);
	return data as ScopeDefinition;
}

/**
 * List all scope definitions, optionally filtered by status, newest first.
 */
export async function listScopeDefinitions(status?: string): Promise<ScopeDefinition[]> {
	let query = getSupabase()
		.from('scope_definitions')
		.select('*')
		.order('updated_at', { ascending: false });

	if (status) query = query.eq('status', status);

	const { data, error } = await query;

	if (error) throw new Error(`Scope definitions list failed: ${error.message}`);
	return (data as ScopeDefinition[]) || [];
}

// ---------------------------------------------------------------------------
// Generation Log
// ---------------------------------------------------------------------------

export interface GenerationLog {
	id: string;
	deal_id: string;
	scope_definition_id: string | null;
	status: 'started' | 'creating_project' | 'creating_phases' | 'creating_tasklists' | 'creating_tasks' | 'updating_crm' | 'completed' | 'failed' | 'partial';
	zoho_project_id: string | null;
	phases_created: number;
	tasklists_created: number;
	tasks_created: number;
	tasks_total: number;
	last_completed_step: string | null;
	error_message: string | null;
	started_at: string;
	completed_at: string | null;
	created_at: string;
}

/**
 * Create a new generation log entry with status 'started'.
 */
export async function createGenerationLog(data: {
	deal_id: string;
	scope_definition_id?: string;
	tasks_total?: number;
}): Promise<GenerationLog | null> {
	try {
		const { data: created, error } = await getSupabase()
			.from('generation_log')
			.insert({
				deal_id: data.deal_id,
				scope_definition_id: data.scope_definition_id ?? null,
				tasks_total: data.tasks_total ?? 0,
				status: 'started'
			})
			.select()
			.single();

		if (error) {
			console.warn('Generation log create failed (non-blocking):', error.message);
			return null;
		}
		return created as GenerationLog;
	} catch (err) {
		console.warn('Generation log create failed (non-blocking):', err);
		return null;
	}
}

/**
 * Update a generation log entry by id.
 */
export async function updateGenerationLog(
	id: string,
	data: Partial<Omit<GenerationLog, 'id' | 'created_at' | 'started_at'>>
): Promise<GenerationLog | null> {
	try {
		const { data: updated, error } = await getSupabase()
			.from('generation_log')
			.update(data)
			.eq('id', id)
			.select()
			.single();

		if (error) {
			console.warn('Generation log update failed (non-blocking):', error.message);
			return null;
		}
		return updated as GenerationLog;
	} catch (err) {
		console.warn('Generation log update failed (non-blocking):', err);
		return null;
	}
}

/**
 * Fetch the most recent generation log for a deal.
 */
export async function getLatestGenerationLog(dealId: string): Promise<GenerationLog | null> {
	try {
		const { data, error } = await getSupabase()
			.from('generation_log')
			.select('*')
			.eq('deal_id', dealId)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (error) {
			console.warn('Generation log fetch failed (non-blocking):', error.message);
			return null;
		}
		return data as GenerationLog | null;
	} catch (err) {
		console.warn('Generation log fetch failed (non-blocking):', err);
		return null;
	}
}

/**
 * Fetch all generation logs for a deal, newest first.
 */
export async function getGenerationLogsByDeal(dealId: string): Promise<GenerationLog[]> {
	try {
		const { data, error } = await getSupabase()
			.from('generation_log')
			.select('*')
			.eq('deal_id', dealId)
			.order('created_at', { ascending: false });

		if (error) {
			console.warn('Generation logs fetch failed (non-blocking):', error.message);
			return [];
		}
		return (data as GenerationLog[]) || [];
	} catch (err) {
		console.warn('Generation logs fetch failed (non-blocking):', err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Field Issues
// ---------------------------------------------------------------------------

export interface FieldIssue {
	id: string;
	deal_id: string;
	trade_partner_id: string | null;
	issue_type:
		| 'damaged_material'
		| 'field_conflict'
		| 'missing_info'
		| 'access_issue'
		| 'design_conflict'
		| 'unexpected_condition'
		| 'safety';
	severity: 'low' | 'medium' | 'high' | 'critical';
	title: string;
	description: string | null;
	photo_ids: string[] | null;
	status: 'open' | 'acknowledged' | 'resolved';
	resolved_at: string | null;
	created_at: string;
}

/**
 * Create a new field issue for a deal.
 */
export async function createFieldIssue(
	data: Omit<FieldIssue, 'id' | 'resolved_at' | 'created_at'>
): Promise<FieldIssue> {
	const { data: created, error } = await getSupabase()
		.from('field_issues')
		.insert(data)
		.select()
		.single();

	if (error) throw new Error(`Field issue create failed: ${error.message}`);
	return created as FieldIssue;
}

/**
 * Fetch all field issues for a deal, newest first.
 */
export async function getFieldIssuesForDeal(dealId: string): Promise<FieldIssue[]> {
	const { data, error } = await getSupabase()
		.from('field_issues')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Field issue fetch failed: ${error.message}`);
	return (data as FieldIssue[]) || [];
}

/**
 * Fetch field issues for a deal filtered to one trade partner, newest first.
 */
export async function getFieldIssuesByTradePartner(
	dealId: string,
	tradePartnerId: string
): Promise<FieldIssue[]> {
	const { data, error } = await getSupabase()
		.from('field_issues')
		.select('*')
		.eq('deal_id', dealId)
		.eq('trade_partner_id', tradePartnerId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Field issue fetch failed: ${error.message}`);
	return (data as FieldIssue[]) || [];
}

/**
 * Update status (and resolution timestamp when resolved) for a field issue.
 */
export async function updateFieldIssueStatus(
	id: string,
	status: string,
	resolvedAt?: string
): Promise<FieldIssue> {
	const updateData: { status: string; resolved_at?: string } = { status };
	if (status === 'resolved') {
		updateData.resolved_at = resolvedAt ?? new Date().toISOString();
	}

	const { data, error } = await getSupabase()
		.from('field_issues')
		.update(updateData)
		.eq('id', id)
		.select()
		.single();

	if (error) throw new Error(`Field issue update failed: ${error.message}`);
	return data as FieldIssue;
}

/**
 * Fetch unresolved field issues for a deal, ordered by severity then newest first.
 */
export async function getOpenFieldIssuesForDeal(dealId: string): Promise<FieldIssue[]> {
	const { data, error } = await getSupabase()
		.from('field_issues')
		.select('*')
		.eq('deal_id', dealId)
		.neq('status', 'resolved')
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Field issue open fetch failed: ${error.message}`);

	const severityRank: Record<FieldIssue['severity'], number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3
	};

	// Supabase does not support custom enum order sorting here, so we sort severity in JS.
	return ((data as FieldIssue[]) || []).sort((a, b) => {
		const severityDiff = severityRank[a.severity] - severityRank[b.severity];
		if (severityDiff !== 0) return severityDiff;
		return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
	});
}

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

export interface ProcurementItem {
	id: string;
	deal_id: string;
	item_name: string;
	category: string | null;
	status: string;
	vendor: string | null;
	cost: number | null;
	lead_time_days: number | null;
	expected_date: string | null;
	actual_date: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Create a new procurement item for a deal.
 */
export async function createProcurementItem(
	data: Omit<ProcurementItem, 'id' | 'created_at' | 'updated_at'>
): Promise<ProcurementItem> {
	const { data: created, error } = await getSupabase()
		.from('procurement_items')
		.insert(data)
		.select()
		.single();

	if (error) throw new Error(`Procurement item create failed: ${error.message}`);
	return created as ProcurementItem;
}

/**
 * Fetch all procurement items for a deal, newest first.
 */
export async function getProcurementForDeal(dealId: string): Promise<ProcurementItem[]> {
	const { data, error } = await getSupabase()
		.from('procurement_items')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Procurement item fetch failed: ${error.message}`);
	return (data as ProcurementItem[]) || [];
}

/**
 * Update selected fields for a procurement item.
 */
export async function updateProcurementItem(
	id: string,
	updates: Partial<
		Pick<
			ProcurementItem,
			'status' | 'vendor' | 'cost' | 'lead_time_days' | 'expected_date' | 'actual_date' | 'notes'
		>
	>
): Promise<ProcurementItem> {
	const { data, error } = await getSupabase()
		.from('procurement_items')
		.update({ ...updates, updated_at: new Date().toISOString() })
		.eq('id', id)
		.select()
		.single();

	if (error) throw new Error(`Procurement item update failed: ${error.message}`);
	return data as ProcurementItem;
}

// ---------------------------------------------------------------------------
// Change Orders
// ---------------------------------------------------------------------------

export interface ChangeOrder {
	id: string;
	deal_id: string;
	title: string;
	description: string | null;
	estimated_amount: number | null;
	approved_amount: number | null;
	status: string;
	identified_by: string | null;
	identified_at: string;
	approved_at: string | null;
	billed_at: string | null;
	created_at: string;
}

/**
 * Create a new change order for a deal.
 */
export async function createChangeOrder(
	data: Omit<ChangeOrder, 'id' | 'identified_at' | 'approved_at' | 'billed_at' | 'created_at'>
): Promise<ChangeOrder> {
	const { data: created, error } = await getSupabase()
		.from('change_orders')
		.insert(data)
		.select()
		.single();

	if (error) throw new Error(`Change order create failed: ${error.message}`);
	return created as ChangeOrder;
}

/**
 * Fetch all change orders for a deal, newest first.
 */
export async function getChangeOrdersForDeal(dealId: string): Promise<ChangeOrder[]> {
	const { data, error } = await getSupabase()
		.from('change_orders')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Change order fetch failed: ${error.message}`);
	return (data as ChangeOrder[]) || [];
}

/**
 * Update selected fields for a change order.
 */
export async function updateChangeOrder(
	id: string,
	updates: Partial<
		Pick<
			ChangeOrder,
			'title' | 'description' | 'estimated_amount' | 'approved_amount' | 'status' | 'approved_at' | 'billed_at'
		>
	>
): Promise<ChangeOrder> {
	const { data, error } = await getSupabase()
		.from('change_orders')
		.update(updates)
		.eq('id', id)
		.select()
		.single();

	if (error) throw new Error(`Change order update failed: ${error.message}`);
	return data as ChangeOrder;
}

// ---------------------------------------------------------------------------
// Field Updates (native, stored in Supabase)
// ---------------------------------------------------------------------------

export interface FieldUpdate {
	id: string;
	deal_id: string;
	trade_partner_id: string | null;
	update_type: string;
	note: string | null;
	photo_ids: string[] | null;
	/**
	 * Curated, client-facing photos (a subset/separate set chosen by the crew).
	 * These are the ONLY photos shown in the homeowner portal and are mirrored to
	 * the deal's WorkDrive "Client Portal/Photos" folder. Optional so existing
	 * callers and rows are unaffected.
	 */
	client_photo_ids?: string[] | null;
	created_at: string;
}

export async function createFieldUpdate(
	data: Omit<FieldUpdate, 'id' | 'created_at'>
): Promise<FieldUpdate> {
	const { data: created, error } = await getSupabase()
		.from('field_updates')
		.insert(data)
		.select()
		.single();

	if (error) throw new Error(`Field update create failed: ${error.message}`);
	return created as FieldUpdate;
}

export async function getFieldUpdatesByDeal(dealId: string): Promise<FieldUpdate[]> {
	const { data, error } = await getSupabase()
		.from('field_updates')
		.select('*')
		.eq('deal_id', dealId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Field update fetch failed: ${error.message}`);
	return (data as FieldUpdate[]) || [];
}

// ---------------------------------------------------------------------------
// Task subtasks (QC checklist items attached to a Zoho Projects task)
// ---------------------------------------------------------------------------

export interface TaskSubtask {
	id: string;
	deal_id: string | null;
	project_id: string | null;
	parent_task_id: string;
	trade_slug: string | null;
	label: string;
	sort_order: number;
	is_done: boolean;
	done_by: string | null;
	done_at: string | null;
	created_at: string;
}

/** Subtasks for a set of Zoho task ids (for rendering under each task). */
export async function getSubtasksForTasks(taskIds: string[]): Promise<TaskSubtask[]> {
	if (taskIds.length === 0) return [];
	const { data, error } = await getSupabase()
		.from('task_subtasks')
		.select('*')
		.in('parent_task_id', taskIds)
		.order('parent_task_id', { ascending: true })
		.order('sort_order', { ascending: true });
	if (error) throw new Error(`Subtasks fetch failed: ${error.message}`);
	return (data as TaskSubtask[]) || [];
}

/** All subtasks for a Zoho project. */
export async function getSubtasksForProject(projectId: string): Promise<TaskSubtask[]> {
	const { data, error } = await getSupabase()
		.from('task_subtasks')
		.select('*')
		.eq('project_id', projectId)
		.order('parent_task_id', { ascending: true })
		.order('sort_order', { ascending: true });
	if (error) throw new Error(`Subtasks fetch failed: ${error.message}`);
	return (data as TaskSubtask[]) || [];
}

/**
 * Insert checklist subtasks. Idempotent on (parent_task_id, label) so re-runs
 * don't duplicate. Returns count attempted.
 */
export async function insertSubtasks(
	rows: Array<{
		deal_id: string | null;
		project_id: string | null;
		parent_task_id: string;
		trade_slug: string | null;
		label: string;
		sort_order: number;
	}>
): Promise<number> {
	if (rows.length === 0) return 0;
	const { error } = await getSupabase()
		.from('task_subtasks')
		.upsert(rows, { onConflict: 'parent_task_id,label', ignoreDuplicates: true });
	if (error) throw new Error(`Subtasks insert failed: ${error.message}`);
	return rows.length;
}

/** Toggle a single subtask's done state. Returns the updated row or null. */
export async function setSubtaskDone(
	id: string,
	isDone: boolean,
	doneBy: string | null
): Promise<TaskSubtask | null> {
	const { data, error } = await getSupabase()
		.from('task_subtasks')
		.update({
			is_done: isDone,
			done_by: isDone ? doneBy : null,
			done_at: isDone ? new Date().toISOString() : null
		})
		.eq('id', id)
		.select()
		.single();
	if (error) return null;
	return data as TaskSubtask;
}

/** True if a project already has any subtasks (so we don't regenerate blindly). */
export async function projectHasSubtasks(projectId: string): Promise<boolean> {
	const { count, error } = await getSupabase()
		.from('task_subtasks')
		.select('id', { count: 'exact', head: true })
		.eq('project_id', projectId);
	if (error) return false;
	return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Scope Tasks
// ---------------------------------------------------------------------------

export interface ScopeTask {
	id: string;
	deal_id: string;
	task_name: string;
	phase: string;
	phase_order?: number;
	trade: string | null;
	description: string | null;
	duration_days: number;
	sort_order: number;
	requires_inspection: boolean;
	requires_client_decision: boolean;
	dependency_id: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Fetch all scope tasks for a deal, ordered by phase then sort_order.
 */
export async function getScopeTasksByDeal(dealId: string): Promise<ScopeTask[]> {
	const { data, error } = await getSupabase()
		.from('scope_tasks')
		.select('*')
		.eq('deal_id', dealId)
		.order('sort_order');

	if (error) throw new Error(`Scope tasks fetch failed: ${error.message}`);
	return (data as ScopeTask[]) || [];
}

/**
 * Insert or update a single scope task.
 */
export async function upsertScopeTask(
	task: Omit<ScopeTask, 'created_at' | 'updated_at'>
): Promise<ScopeTask> {
	const { phase_order, ...taskData } = task;
	const { data, error } = await getSupabase()
		.from('scope_tasks')
		.upsert([{ ...taskData, updated_at: new Date().toISOString() }], { onConflict: 'id' })
		.select()
		.single();

	if (error) throw new Error(`Scope task upsert failed: ${error.message}`);
	return data as ScopeTask;
}

/**
 * Delete a single scope task by id.
 */
export async function deleteScopeTask(id: string): Promise<void> {
	const { error } = await getSupabase()
		.from('scope_tasks')
		.delete()
		.eq('id', id);

	if (error) throw new Error(`Scope task delete failed: ${error.message}`);
}

/**
 * Bulk upsert scope tasks for a deal: clears existing tasks then inserts new ones.
 */
export async function bulkUpsertScopeTasks(
	dealId: string,
	tasks: Array<Omit<ScopeTask, 'created_at' | 'updated_at'>>
): Promise<ScopeTask[]> {
	const supabase = getSupabase();

	// Clear existing tasks for this deal
	const { error: deleteError } = await supabase
		.from('scope_tasks')
		.delete()
		.eq('deal_id', dealId);

	if (deleteError) throw new Error(`Scope tasks clear failed: ${deleteError.message}`);

	if (tasks.length === 0) return [];

	const now = new Date().toISOString();
	const rows = tasks.map(({ phase_order, ...t }) => ({
		...t,
		deal_id: dealId,
		updated_at: now
	}));

	const { data, error } = await supabase
		.from('scope_tasks')
		.insert(rows)
		.select();

	if (error) throw new Error(`Scope tasks bulk insert failed: ${error.message}`);
	return (data as ScopeTask[]) || [];
}

/**
 * Delete all scope tasks for a deal.
 */
export async function clearScopeTasks(dealId: string): Promise<void> {
	const { error } = await getSupabase()
		.from('scope_tasks')
		.delete()
		.eq('deal_id', dealId);

	if (error) throw new Error(`Scope tasks clear failed: ${error.message}`);
}

/**
 * Fetch all active task templates (all project types) for the library modal.
 */
export async function getAllActiveTaskTemplates(): Promise<TaskTemplate[]> {
	const { data, error } = await getSupabase()
		.from('task_templates')
		.select('id, project_type, phase, task_name, trade, description, default_duration_days, dependency_key, requires_inspection, requires_client_decision, material_lead_time_days, sort_order, is_conditional, condition_key, condition_value, active, created_at')
		.eq('active', true)
		.order('phase')
		.order('sort_order');

	if (error) throw new Error(`Task templates fetch failed: ${error.message}`);
	return (data as TaskTemplate[]) || [];
}

// ---------------------------------------------------------------------------
// Transcoding job queue
// ---------------------------------------------------------------------------

export interface TranscodingJob {
	id: string;
	field_update_id: string | null;
	original_path: string;
	output_path: string | null;
	zoho_record_id: string | null;
	zoho_module: string;
	status: 'pending' | 'processing' | 'done' | 'failed';
	error: string | null;
	attempts: number;
	created_at: string;
	updated_at: string;
}

export async function createTranscodingJob(data: {
	field_update_id?: string;
	original_path: string;
	zoho_record_id?: string;
	zoho_module?: string;
}): Promise<TranscodingJob> {
	const { data: created, error } = await getSupabase()
		.from('transcoding_jobs')
		.insert({
			field_update_id: data.field_update_id ?? null,
			original_path: data.original_path,
			zoho_record_id: data.zoho_record_id ?? null,
			zoho_module: data.zoho_module ?? 'Field_Updates'
		})
		.select()
		.single();
	if (error) throw new Error(`Transcoding job create failed: ${error.message}`);
	return created as TranscodingJob;
}

export async function updateTranscodingJob(
	id: string,
	update: Partial<Pick<TranscodingJob, 'status' | 'output_path' | 'error' | 'attempts'>>
): Promise<void> {
	const { error } = await getSupabase()
		.from('transcoding_jobs')
		.update({ ...update, updated_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw new Error(`Transcoding job update failed: ${error.message}`);
}

export async function replacePhotoIdInFieldUpdate(
	fieldUpdateId: string,
	oldPath: string,
	newPath: string
): Promise<void> {
	const db = getSupabase();
	const { data, error: fetchError } = await db
		.from('field_updates')
		.select('photo_ids')
		.eq('id', fieldUpdateId)
		.single();
	if (fetchError || !data) return;
	const photoIds: string[] = Array.isArray(data.photo_ids) ? data.photo_ids : [];
	const updated = photoIds.map((p: string) => (p === oldPath ? newPath : p));
	await db.from('field_updates').update({ photo_ids: updated }).eq('id', fieldUpdateId);
}

/* ── Process Map Notes ────────────────────────────── */

export interface ProcessMapNote {
	step_code: string;
	note: string;
	updated_at: string;
}

export async function getAllProcessMapNotes(): Promise<Record<string, string>> {
	const { data, error } = await supabase
		.from('process_map_notes')
		.select('step_code, note');
	if (error) throw new Error(error.message);
	const notes: Record<string, string> = {};
	for (const row of data ?? []) {
		notes[row.step_code] = row.note;
	}
	return notes;
}

export async function upsertProcessMapNote(stepCode: string, note: string): Promise<void> {
	const { error } = await supabase
		.from('process_map_notes')
		.upsert({ step_code: stepCode, note, updated_at: new Date().toISOString() }, { onConflict: 'step_code' });
	if (error) throw new Error(error.message);
}
