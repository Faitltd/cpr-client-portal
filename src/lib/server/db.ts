import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

let supabaseClient: SupabaseClient<any, any, any> | null = null;

function getSupabase() {
	if (supabaseClient) return supabaseClient;

	const SUPABASE_URL = env.SUPABASE_URL;
	const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error('Missing Supabase environment variables');
	}

	supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false }
	});
	return supabaseClient;
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
 * Fetch client auth details by email
 */
export async function getClientAuthByEmail(email: string): Promise<ClientAuth | null> {
	const { data, error } = await getSupabase()
		.from('clients')
		.select('id, email, password_hash, portal_active')
		.ilike('email', email)
		.single();

	if (error || !data) return null;
	return data as ClientAuth;
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
	await getSupabase().from('client_sessions').delete().eq('session_token', sessionToken);
}

/**
 * Fetch trade partner auth details by email
 */
export async function getTradePartnerAuthByEmail(email: string): Promise<TradePartnerAuth | null> {
	const { data, error } = await getSupabase()
		.from('trade_partners')
		.select('id, email, password_hash')
		.ilike('email', email)
		.single();

	if (error || !data) return null;
	return data as TradePartnerAuth;
}

/**
 * Store or update trade partner record from Zoho
 */
export async function upsertTradePartner(tradePartner: Omit<TradePartner, 'id'>): Promise<TradePartner> {
	const insertData = {
		zoho_trade_partner_id: tradePartner.zoho_trade_partner_id,
		email: tradePartner.email.toLowerCase(),
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
				.ilike('email', insertData.email)
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


/**
 * Fetch latest Zoho tokens
 */
export async function getZohoTokens(): Promise<ZohoTokens | null> {
	const { data, error } = await getSupabase()
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
			const { data, error } = await getSupabase()
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

	const { data, error } = await getSupabase()
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
