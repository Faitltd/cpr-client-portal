import { zohoApiCall } from './zoho';
import type { Client } from './db';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const log = createLogger('auth');

const PORTAL_DEV_SHOW_ALL = env.PORTAL_DEV_SHOW_ALL;
const ZOHO_TRADE_PARTNERS_MODULE = env.ZOHO_TRADE_PARTNERS_MODULE;

type ClientProfile = Omit<Client, 'id'>;

type ClientProfileWithUser = ClientProfile & { zoho_user_id: string };

type ZohoUser = { id: string; email?: string };

type TradePartnerProfile = {
	zoho_trade_partner_id: string;
	email: string;
	name?: string | null;
	company?: string | null;
	phone?: string | null;
};

const DEAL_FIELDS = [
	'Deal_Name',
	'Stage',
	'Amount',
	'Closing_Date',
	'Created_Time',
	'Modified_Time',
	'Owner',
	'Contact_Name',
	'Account_Name',
	'Address',
	'Address_Line_2',
	'Street',
	'City',
	'State',
	'Zip_Code',
	'Garage_Code',
	'WiFi',
	'Refined_SOW',
	'File_Upload',
	'External_Link',
	'Progress_Photos',
	'Client_Portal_Folder',
	'Portal_Trade_Partners',
	'Zoho_Projects_ID'
].join(',');

const CONTACT_FIELDS = [
	'First_Name',
	'Last_Name',
	'Full_Name',
	'Email',
	'Phone',
	'Mobile',
	'Home_Phone',
	'Account_Name'
].join(',');

const TRADE_PARTNER_FIELD_KEYS = [
	'Name',
	'First_Name',
	'Last_Name',
	'Full_Name',
	'Trade_Partner_Name',
	'Business_Name',
	'Company',
	'Company_Name',
	'Account_Name',
	'Email',
	'Secondary_Email',
	'Email_1',
	'Email_Address',
	'Email_Address_1',
	'Phone',
	'Phone1',
	'Office_Phone',
	'Mobile',
	'Phone_Number'
];

const TRADE_PARTNERS_MODULES = (ZOHO_TRADE_PARTNERS_MODULE || 'Trade_Partners')
	.split(',')
	.map((name) => name.trim())
	.filter(Boolean);
// Alternative Zoho modules where the trade partner record might actually live.
// The sync pulls from Trade_Partners, but the ID may belong to Vendors/Contacts/Accounts.
const ALTERNATIVE_TP_MODULES = ['Vendors', 'Contacts', 'Accounts'];

const PORTAL_ACTIVE_DEAL_STAGES = new Set([
	'design needed',
	'design review needed',
	'design review booked',
	'redesign needed',
	'estimate needed',
	'estimate review needed',
	'estimate review booked',
	'estimate revision needed',
	'quoted',
	'contract needed',
	'contract sent',
	'project created'
]);

const PASSWORD_SEED_DEAL_STAGES = new Set(['project started', 'project created']);

function normalizeStage(stage: string | null | undefined) {
	if (!stage) return '';
	return stage
		.trim()
		.toLowerCase()
		.replace(/\s*\(\s*\d+\s*%?\s*\)\s*/g, '')
		.trim();
}

export function isPortalActiveStage(stage: string | null | undefined) {
	const normalized = normalizeStage(stage);
	return normalized ? PORTAL_ACTIVE_DEAL_STAGES.has(normalized) : false;
}

function isPasswordSeedStage(stage: string | null | undefined) {
	const normalized = normalizeStage(stage);
	return normalized ? PASSWORD_SEED_DEAL_STAGES.has(normalized) : false;
}

function mapContact(contact: any): ClientProfile {
	const firstName = contact.First_Name || null;
	const lastName = contact.Last_Name || null;
	const fullName = contact.Full_Name || [firstName, lastName].filter(Boolean).join(' ') || null;
	const phone = pickFirst(contact, ['Phone', 'Mobile', 'Home_Phone', 'Phone_Number']) || null;

	return {
		zoho_contact_id: contact.id,
		email: contact.Email,
		first_name: firstName,
		last_name: lastName,
		full_name: fullName,
		company: contact.Account_Name?.name || null,
		phone
	};
}

function pickFirst(record: any, keys: string[]) {
	for (const key of keys) {
		const value = record?.[key];
		if (value) return value;
	}
	return null;
}

function looksLikeEmail(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (trimmed.includes(' ')) return false;
	return /^[^@]+@[^@]+\.[^@]+$/.test(trimmed);
}

function coerceEmail(value: any): string | null {
	if (!value) return null;
	if (typeof value === 'string') {
		return looksLikeEmail(value) ? value.trim() : null;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = coerceEmail(item);
			if (found) return found;
		}
		return null;
	}
	if (typeof value === 'object') {
		return (
			coerceEmail(value.email) ||
			coerceEmail(value.Email) ||
			coerceEmail(value.value) ||
			coerceEmail(value.display_value) ||
			coerceEmail(value.displayValue)
		);
	}
	return null;
}

function findEmailInRecord(record: any): string | null {
	if (!record || typeof record !== 'object') return null;
	for (const [key, value] of Object.entries(record)) {
		if (key.toLowerCase().includes('email')) {
			const found = coerceEmail(value);
			if (found) return found;
		}
	}
	for (const value of Object.values(record)) {
		const found = coerceEmail(value);
		if (found) return found;
	}
	return null;
}

function mapTradePartner(record: any): TradePartnerProfile | null {
	const email =
		pickFirst(record, ['Email', 'Secondary_Email', 'Email_1', 'Email_Address', 'Email_Address_1']) ||
		findEmailInRecord(record);
	if (!email) return null;

	const firstName = record.Name || record.First_Name || null;
	const lastName = record.Last_Name || null;
	const name =
		pickFirst(record, ['Business_Name', 'Trade_Partner_Name', 'Full_Name', 'Name']) ||
		[firstName, lastName].filter(Boolean).join(' ') ||
		email;

	const company =
		pickFirst(record, ['Business_Name', 'Company', 'Company_Name']) ||
		record.Account_Name?.name ||
		null;
	const phone = pickFirst(record, ['Phone', 'Phone1', 'Office_Phone', 'Mobile', 'Phone_Number']) || null;

	return {
		zoho_trade_partner_id: record.id,
		email,
		name,
		company,
		phone
	};
}

function extractDisplayValue(value: any): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'object') {
		return (
			value.name ||
			value.display_value ||
			value.displayValue ||
			value.value ||
			value.label ||
			null
		);
	}
	return null;
}

function coerceText(value: any): string | null {
	const direct = extractDisplayValue(value);
	if (direct) return direct;
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => extractDisplayValue(item))
			.filter(Boolean)
			.map(String);
		if (parts.length > 0) return parts.join(', ');
	}
	if (value && typeof value === 'object') {
		const parts = Object.values(value)
			.map((item) => extractDisplayValue(item))
			.filter(Boolean)
			.map(String);
		if (parts.length > 0) return parts.join(', ');
	}
	return null;
}

function extractLookup(value: any) {
	if (!value || typeof value !== 'object') return null;
	const id = value.id || value.ID || value.Id;
	if (!id) return null;
	const name =
		value.name ||
		value.display_value ||
		value.displayValue ||
		value.value ||
		value.label ||
		null;
	return { id, name };
}

function findDealLookup(record: Record<string, any>) {
	const preferredKeys = [
		'Deal_Name',
		'Deal',
		'Deals',
		'Portal_Deal',
		'Portal_Deals',
		'Portal_Deals1',
		'Portal_Deals2',
		'Portal_Deals3'
	];
	for (const key of preferredKeys) {
		const lookup = extractLookup(record[key]);
		if (lookup) return { ...lookup, key };
	}

	for (const [key, value] of Object.entries(record)) {
		if (!/deal/i.test(key)) continue;
		const lookup = extractLookup(value);
		if (lookup) return { ...lookup, key };
	}
	return null;
}

function normalizeDealRecord(deal: any) {
	if (!deal || typeof deal !== 'object') return deal;
	const lookup = findDealLookup(deal);
	// Many Zoho related-list/junction records include their own `id` plus a Deal lookup field.
	// We want the *Deal* id consistently so downstream endpoints can safely call `/Deals/:id/...`.
	const inferredDealId =
		deal.Deal?.id ||
		deal?.Deal_Name?.id ||
		deal?.Potential_Name?.id ||
		lookup?.id ||
		deal.Deal_ID ||
		deal.deal_id ||
		null;
	const id = inferredDealId || deal.id;
	const name =
		extractDisplayValue(deal.Deal_Name) ||
		lookup?.name ||
		extractDisplayValue(deal.Potential_Name) ||
		extractDisplayValue(deal.Name) ||
		extractDisplayValue(deal.name) ||
		extractDisplayValue(deal.Subject) ||
		extractDisplayValue(deal.Full_Name) ||
		extractDisplayValue(deal.Display_Name) ||
		extractDisplayValue(deal.display_name) ||
		(id ? `Deal ${String(id).slice(-6)}` : null);
	const normalized = { ...deal };
	if (inferredDealId) {
		normalized.id = inferredDealId;
	} else if (!normalized.id && id) {
		normalized.id = id;
	}

	// Normalize the display name to a plain string for consistent rendering.
	if (name && (typeof normalized.Deal_Name !== 'string' || !normalized.Deal_Name)) {
		normalized.Deal_Name = name;
	} else if (!normalized.Deal_Name && name) {
		normalized.Deal_Name = name;
	}

	const textFields = [
		'Address',
		'Address_Line_2',
		'Street',
		'City',
		'State',
		'Zip_Code',
		'Garage_Code',
		'WiFi',
		'Refined_SOW',
		'Notes1',
		'Stage'
	];
	for (const field of textFields) {
		const current = normalized[field];
		if (current && typeof current === 'string') continue;
		const coerced = coerceText(current);
		if (coerced) normalized[field] = coerced;
	}
	if (!normalized.Notes1 && normalized.Refined_SOW) {
		normalized.Notes1 = normalized.Refined_SOW;
	}

	return normalized;
}

function ensureDealId(deal: any, index: number) {
	if (!deal || typeof deal !== 'object') return deal;
	if (!deal.id) {
		return { ...deal, id: `idx-${index + 1}` };
	}
	return deal;
}

/**
 * Fetch current Zoho CRM user (admin)
 */
export async function getZohoCurrentUser(accessToken: string, apiDomain?: string): Promise<ZohoUser> {
	const response = await zohoApiCall(accessToken, '/users?type=CurrentUser', {}, apiDomain);
	const user = response.users?.[0];
	if (!user) {
		throw new Error('No user found in Zoho response');
	}
	return { id: user.id, email: user.email };
}

/**
 * Find all Zoho contacts by email (admin token)
 */
export async function findContactsByEmail(
	accessToken: string,
	email: string,
	apiDomain?: string
): Promise<ClientProfile[]> {
	const search = await zohoApiCall(
		accessToken,
		`/Contacts/search?email=${encodeURIComponent(email)}&fields=${encodeURIComponent(CONTACT_FIELDS)}`,
		{},
		apiDomain
	);

	const contacts = Array.isArray(search.data) ? search.data : [];
	if (contacts.length > 0) {
		return contacts.map(mapContact).filter((contact: ClientProfile) => Boolean(contact.email));
	}

	const allContacts = await listAllContacts(accessToken, apiDomain);
	const targetEmail = email.trim().toLowerCase();
	return allContacts.filter((contact) => contact.email?.trim().toLowerCase() === targetEmail);
}

/**
 * Find Zoho contact by email (admin token)
 */
export async function findContactByEmail(accessToken: string, email: string, apiDomain?: string): Promise<ClientProfile | null> {
	const contacts = await findContactsByEmail(accessToken, email, apiDomain);
	return contacts[0] || null;
}

/**
 * Get Zoho Contact ID from access token (client-style OAuth)
 * Uses the /users?type=CurrentUser endpoint to identify the authenticated user
 */
export async function getAuthenticatedContact(accessToken: string, apiDomain?: string): Promise<ClientProfileWithUser> {
	try {
		const response = await zohoApiCall(accessToken, '/users?type=CurrentUser', {}, apiDomain);
		const user = response.users?.[0];

		if (!user) {
			throw new Error('No user found in Zoho response');
		}

		const contactSearch = await zohoApiCall(
			accessToken,
			`/Contacts/search?email=${encodeURIComponent(user.email)}&fields=${encodeURIComponent(CONTACT_FIELDS)}`,
			{},
			apiDomain
		);

		const contact = contactSearch.data?.[0];
		if (!contact) {
			throw new Error('Contact record not found for user');
		}

		return {
			...mapContact(contact),
			zoho_user_id: user.id
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error('Failed to get authenticated contact', { error: message });
		throw error;
	}
}

/**
 * Filter deals to only show those related to the authenticated contact
 */
export async function getContactDeals(accessToken: string, contactId: string, apiDomain?: string) {
	const perPage = 200;
	const maxPages = 20;

	// 1) Try search endpoint (most reliable without COQL)
	try {
		const criteria = `(Contact_Name:equals:${contactId})`;
		const searchResults: any[] = [];

		for (let page = 1; page <= maxPages; page += 1) {
			const search = await zohoApiCall(
				accessToken,
				`/Deals/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=${perPage}&page=${page}`,
				{},
				apiDomain
			);
			const pageData = Array.isArray(search.data) ? search.data : [];
			if (pageData.length === 0) break;

			searchResults.push(...pageData);
			const hasMore = search.info?.more_records;
			if (hasMore === false) break;
			if (hasMore !== true && pageData.length < perPage) break;
		}

		if (searchResults.length > 0) return searchResults;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.warn('Deals search failed, falling back to COQL', {
			contactId,
			apiDomain: apiDomain || 'default',
			error: message
		});
	}

	// 2) Try COQL if enabled
	try {
		const escapedContactId = contactId.replace(/'/g, "\\'");
		const coqlResults: any[] = [];

		for (let page = 0; page < maxPages; page += 1) {
			const offset = page * perPage;
			const query = {
				select_query: `SELECT ${DEAL_FIELDS} FROM Deals WHERE Contact_Name = '${escapedContactId}' ORDER BY Created_Time DESC LIMIT ${perPage} OFFSET ${offset}`
			};

			const response = await zohoApiCall(
				accessToken,
				'/coql',
				{
					method: 'POST',
					body: JSON.stringify(query)
				},
				apiDomain
			);
			const pageData = Array.isArray(response.data) ? response.data : [];
			if (pageData.length === 0) break;

			coqlResults.push(...pageData);
			if (pageData.length < perPage) break;
		}

		if (coqlResults.length > 0) return coqlResults;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.warn('COQL query failed, falling back to standard API', {
			contactId,
			apiDomain: apiDomain || 'default',
			error: message
		});
	}

	// 3) Fallback to standard list + client-side filter
	const allDeals: any[] = [];
	for (let page = 1; page <= maxPages; page += 1) {
		const deals = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=${perPage}&page=${page}`,
			{},
			apiDomain
		);

		const pageData = Array.isArray(deals.data) ? deals.data : [];
		if (pageData.length === 0) break;

		allDeals.push(...pageData);
		const hasMore = deals.info?.more_records;
		if (hasMore === false) break;
		if (hasMore !== true && pageData.length < perPage) break;
	}

	const filtered = allDeals.filter((deal: any) => deal.Contact_Name?.id === contactId);

	if (filtered.length === 0 && dev && PORTAL_DEV_SHOW_ALL === 'true') {
		return allDeals;
	}

	return filtered;
}

/**
 * Fetch ALL deals from Zoho CRM with pagination.
 * Trade partners see every deal — no per-partner filtering.
 */
export async function getTradePartnerDeals(accessToken: string, _tradePartnerId?: string, apiDomain?: string): Promise<any[]> {
	const perPage = 200;
	const maxPages = 20;
	const allDeals: any[] = [];

	for (let page = 1; page <= maxPages; page += 1) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=${perPage}&page=${page}`,
			{},
			apiDomain
		);
		const pageData = Array.isArray(response.data) ? response.data : [];
		if (pageData.length === 0) break;
		allDeals.push(...pageData);
		const hasMore = response.info?.more_records;
		if (hasMore === false) break;
		if (hasMore !== true && pageData.length < perPage) break;
	}

	return allDeals.map(normalizeDealRecord).map(ensureDealId);
}

/**
 * Get documents/attachments for deals visible to contact
 */
export async function getContactDocuments(accessToken: string, dealId: string, apiDomain?: string) {
	return zohoApiCall(accessToken, `/Deals/${dealId}/Attachments`, {}, apiDomain);
}

/**
 * Get notes for a specific deal
 */
export async function getDealNotes(accessToken: string, dealId: string, apiDomain?: string) {
	return zohoApiCall(accessToken, `/Deals/${dealId}/Notes`, {}, apiDomain);
}


/**
 * Fetch all Zoho contacts (admin) and map to client profiles
 */
export async function listAllContacts(accessToken: string, apiDomain?: string): Promise<ClientProfile[]> {
	const perPage = 200;
	let page = 1;
	let more = true;
	const results: ClientProfile[] = [];

	while (more) {
		const response = await zohoApiCall(
			accessToken,
			`/Contacts?fields=${encodeURIComponent(CONTACT_FIELDS)}&page=${page}&per_page=${perPage}`,
			{},
			apiDomain
		);

		const contacts = response.data || [];
		for (const contact of contacts) {
			if (contact.Email) {
				results.push(mapContact(contact));
			}
		}

		more = Boolean(response.info?.more_records);
		page += 1;
	}

	return results;
}

async function listEmailFieldNames(
	accessToken: string,
	moduleName: string,
	apiDomain?: string
): Promise<string[]> {
	try {
		const response = await zohoApiCall(
			accessToken,
			`/settings/fields?module=${encodeURIComponent(moduleName)}`,
			{},
			apiDomain
		);
		const fields = (response.fields || response.data || []) as any[];
		const emailFields: string[] = [];
		for (const field of fields) {
			const apiName = String(field?.api_name || field?.apiName || '').trim();
			if (!apiName) continue;
			const label = String(field?.field_label || field?.fieldLabel || field?.display_label || '')
				.toLowerCase()
				.trim();
			const dataType = String(field?.data_type || field?.json_type || field?.dataType || '')
				.toLowerCase()
				.trim();
			if (
				apiName.toLowerCase().includes('email') ||
				label.includes('email') ||
				dataType === 'email'
			) {
				emailFields.push(apiName);
			}
		}
		return emailFields;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn('Trade partner field metadata fetch failed', { moduleName, error: message });
		return [];
	}
}

async function buildTradePartnerFields(
	accessToken: string,
	moduleName: string,
	apiDomain?: string
): Promise<string> {
	const fields = new Set(TRADE_PARTNER_FIELD_KEYS);
	const emailFields = await listEmailFieldNames(accessToken, moduleName, apiDomain);
	for (const field of emailFields) fields.add(field);
	return Array.from(fields).join(',');
}

async function fetchTradePartnersByIds(
	accessToken: string,
	moduleName: string,
	ids: string[],
	apiDomain?: string
): Promise<any[]> {
	const results: any[] = [];
	for (const id of ids) {
		try {
			const response = await zohoApiCall(
				accessToken,
				`/${moduleName}/${id}`,
				{},
				apiDomain
			);
			const record = response.data?.[0];
			if (record) results.push(record);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to fetch trade partner', { moduleName, id, error: message });
		}
	}

	return results;
}

/**
 * Fetch all Trade Partners from Zoho (Custom Module)
 */
type TradePartnerSyncStats = {
	moduleName: string;
	totalRecords: number;
	mapped: number;
	missingEmail: number;
	recovered: number;
	pages: number;
	emailFields: string[];
};

type TradePartnerSyncResult = {
	partners: TradePartnerProfile[];
	stats: TradePartnerSyncStats[];
};

type TradePartnerDebugInfo = {
	moduleName: string;
	recordId: string;
	email: string | null;
	emailFields: string[];
	keys: string[];
};

export async function debugTradePartnerRecord(
	accessToken: string,
	tradePartnerId: string,
	apiDomain?: string
): Promise<TradePartnerDebugInfo | null> {
	// Try configured modules first, then alternative modules (Vendors, Contacts, Accounts)
	const moduleNames = [
		...(TRADE_PARTNERS_MODULES.length ? TRADE_PARTNERS_MODULES : ['CustomModule1']),
		...ALTERNATIVE_TP_MODULES
	];
	let lastError: Error | null = null;

	for (const moduleName of moduleNames) {
		try {
			const fields = await buildTradePartnerFields(accessToken, moduleName, apiDomain);
			const params = new URLSearchParams();
			if (fields) params.set('fields', fields);
			const response = await zohoApiCall(
				accessToken,
				`/${moduleName}/${tradePartnerId}?${params.toString()}`,
				{},
				apiDomain
			);
			const record = response.data?.[0];
			if (!record) continue;
			const keys = Object.keys(record || {});
			const emailFields = keys.filter((key) => key.toLowerCase().includes('email'));
			const email = findEmailInRecord(record);
			return {
				moduleName,
				recordId: String(record.id || tradePartnerId),
				email,
				emailFields,
				keys
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.toLowerCase().includes('module name given seems to be invalid')) {
				lastError = err as Error;
				continue;
			}
			if (message.toLowerCase().includes('record not found') || message.includes('4100')) {
				continue;
			}
			throw err;
		}
	}

	if (lastError) throw lastError;
	return null;
}

export async function listTradePartnersWithStats(
	accessToken: string,
	apiDomain?: string
): Promise<TradePartnerSyncResult> {
	const perPage = 200;
	const moduleNames = TRADE_PARTNERS_MODULES.length ? TRADE_PARTNERS_MODULES : ['CustomModule1'];
	let lastError: Error | null = null;

	for (const moduleName of moduleNames) {
		try {
			let page = 1;
			let more = true;
			const resultsById = new Map<string, TradePartnerProfile>();
			let missingEmail = 0;
			let recovered = 0;
			let totalRecords = 0;
			let pages = 0;
			const missingEmailIds: string[] = [];
			const missingEmailSamples: Array<{ id?: string; name?: string; keys: string[] }> = [];
			const emailFields = await listEmailFieldNames(accessToken, moduleName, apiDomain);
			const fields = await buildTradePartnerFields(accessToken, moduleName, apiDomain);

			while (more) {
				const params = new URLSearchParams({
					page: String(page),
					per_page: String(perPage)
				});
				if (fields) params.set('fields', fields);
				const response = await zohoApiCall(
					accessToken,
					`/${moduleName}?${params.toString()}`,
					{},
					apiDomain
				);

				const records = response.data || [];
				totalRecords += records.length;
				pages += 1;
				for (const record of records) {
					const mapped = mapTradePartner(record);
					if (mapped) {
						resultsById.set(mapped.zoho_trade_partner_id, mapped);
					} else {
						missingEmail += 1;
						if (record?.id) missingEmailIds.push(String(record.id));
						if (missingEmailSamples.length < 3) {
							missingEmailSamples.push({
								id: record?.id,
								name:
									record?.Name ||
									record?.Full_Name ||
									record?.Trade_Partner_Name ||
									record?.Business_Name,
								keys: Object.keys(record || {}).slice(0, 24)
							});
						}
					}
				}

				more = Boolean(response.info?.more_records);
				page += 1;
			}

			if (missingEmailIds.length > 0) {
				const recoveredRecords = await fetchTradePartnersByIds(
					accessToken,
					moduleName,
					missingEmailIds,
					apiDomain
				);
				for (const record of recoveredRecords) {
					const mapped = mapTradePartner(record);
					if (mapped) {
						const wasMissing = !resultsById.has(mapped.zoho_trade_partner_id);
						resultsById.set(mapped.zoho_trade_partner_id, mapped);
						if (wasMissing) recovered += 1;
					}
				}
				missingEmail = Math.max(0, missingEmailIds.length - recovered);
				if (recovered > 0) {
					log.warn('Trade partner email recovery', {
						moduleName,
						recovered,
						remainingMissing: missingEmail
					});
				}
			}

			if (missingEmail > 0) {
				log.warn('Trade partner records missing email', {
					moduleName,
					missingEmail,
					sample: missingEmailSamples
				});
			}

			return {
				partners: Array.from(resultsById.values()),
				stats: [
					{
						moduleName,
						totalRecords,
						mapped: resultsById.size,
						missingEmail,
						recovered,
						pages,
						emailFields
					}
				]
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.toLowerCase().includes('module name given seems to be invalid')) {
				lastError = err as Error;
				continue;
			}
			throw err;
		}
	}

	throw lastError || new Error('Trade partner module name invalid.');
}

export async function listTradePartners(accessToken: string, apiDomain?: string): Promise<TradePartnerProfile[]> {
	const result = await listTradePartnersWithStats(accessToken, apiDomain);
	return result.partners;
}

function stageMatches(stage: string | null | undefined, stageSet: Set<string>) {
	const normalized = normalizeStage(stage);
	return normalized ? stageSet.has(normalized) : false;
}

async function listDealContactIdsForStages(
	accessToken: string,
	stageSet: Set<string>,
	apiDomain?: string
): Promise<string[]> {
	const perPage = 200;
	let page = 1;
	let more = true;
	const ids = new Set<string>();

	while (more) {
		const response = await zohoApiCall(
			accessToken,
			`/Deals?fields=${encodeURIComponent('Stage,Contact_Name')}&page=${page}&per_page=${perPage}`,
			{},
			apiDomain
		);

		const deals = response.data || [];
		for (const deal of deals) {
			const stage = deal.Stage as string | undefined;
			if (!stageMatches(stage, stageSet)) continue;
			const contactId = deal.Contact_Name?.id;
			if (contactId) ids.add(contactId);
		}

		more = Boolean(response.info?.more_records);
		page += 1;
	}

	return Array.from(ids);
}

async function listPortalActiveDealContactIds(accessToken: string, apiDomain?: string): Promise<string[]> {
	return listDealContactIdsForStages(accessToken, PORTAL_ACTIVE_DEAL_STAGES, apiDomain);
}

async function listPasswordSeedContactIds(accessToken: string, apiDomain?: string): Promise<string[]> {
	return listDealContactIdsForStages(accessToken, PASSWORD_SEED_DEAL_STAGES, apiDomain);
}

async function fetchContactsByIds(accessToken: string, ids: string[], apiDomain?: string): Promise<any[]> {
	const results: any[] = [];
	const chunkSize = 100;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		try {
			const response = await zohoApiCall(
				accessToken,
				`/Contacts?ids=${chunk.join(',')}&fields=${encodeURIComponent(CONTACT_FIELDS)}`,
				{},
				apiDomain
			);
			const contacts = response.data || [];
			results.push(...contacts);
		} catch (error) {
			for (const id of chunk) {
				try {
					const response = await zohoApiCall(
						accessToken,
						`/Contacts/${id}?fields=${encodeURIComponent(CONTACT_FIELDS)}`,
						{},
						apiDomain
					);
					const contact = response.data?.[0];
					if (contact) results.push(contact);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					log.warn('Failed to fetch contact', { id, error: message });
				}
			}
		}
	}

	return results;
}

async function fetchDealsByIds(accessToken: string, ids: string[], apiDomain?: string): Promise<any[]> {
	const results: any[] = [];
	const chunkSize = 100;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		const response = await zohoApiCall(
			accessToken,
			`/Deals?ids=${chunk.join(',')}&fields=${encodeURIComponent(DEAL_FIELDS)}`,
			{},
			apiDomain
		);
		const deals = response.data || [];
		log.debug('fetch deals by ids', {
			chunkSize: chunk.length,
			dealsCount: deals.length,
			apiDomain: apiDomain || 'default'
		});
		results.push(...deals);

		if (deals.length === 0) {
			const fallbackDeals: any[] = [];
			for (const id of chunk) {
				try {
					const fallback = await zohoApiCall(
						accessToken,
						`/Deals/${id}?fields=${encodeURIComponent(DEAL_FIELDS)}`,
						{},
						apiDomain
					);
					const deal = fallback.data?.[0];
					if (deal) fallbackDeals.push(deal);
				} catch (error) {
					log.debug('deal id fetch failed', {
						dealId: id,
						apiDomain: apiDomain || 'default',
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			log.debug('fetch deals by id fallback', {
				chunkSize: chunk.length,
				dealsCount: fallbackDeals.length,
				apiDomain: apiDomain || 'default'
			});
			results.push(...fallbackDeals);

			if (fallbackDeals.length === 0 && chunk.length > 0) {
				try {
					const criteria = `(id:in:${chunk.join(',')})`;
					const search = await zohoApiCall(
						accessToken,
						`/Deals/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=200`,
						{},
						apiDomain
					);
					const searchDeals = search.data || [];
					log.debug('fetch deals by id search', {
						chunkSize: chunk.length,
						dealsCount: searchDeals.length,
						apiDomain: apiDomain || 'default'
					});
					results.push(...searchDeals);
				} catch (error) {
					log.debug('deal id search failed', {
						chunkSize: chunk.length,
						apiDomain: apiDomain || 'default',
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
		}
	}
	return results;
}



/**
 * Fetch contacts attached to active deals only
 */
export async function listContactsForActiveDeals(accessToken: string, apiDomain?: string): Promise<ClientProfile[]> {
	const contactIds = await listPortalActiveDealContactIds(accessToken, apiDomain);
	if (contactIds.length == 0) return [];

	const contacts = await fetchContactsByIds(accessToken, contactIds, apiDomain);
	const results: ClientProfile[] = [];
	for (const contact of contacts) {
		if (contact.Email) {
			results.push(mapContact(contact));
		}
	}
	return results;
}

export async function listContactsForPasswordSeedDeals(
	accessToken: string,
	apiDomain?: string
): Promise<ClientProfile[]> {
	const contactIds = await listPasswordSeedContactIds(accessToken, apiDomain);
	if (contactIds.length == 0) return [];

	const contacts = await fetchContactsByIds(accessToken, contactIds, apiDomain);
	const results: ClientProfile[] = [];
	for (const contact of contacts) {
		if (contact.Email) {
			results.push(mapContact(contact));
		}
	}
	return results;
}
