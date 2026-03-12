import { zohoApiCall } from './zoho';
import type { Client } from './db';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const log = createLogger('auth');

const PORTAL_DEV_SHOW_ALL = env.PORTAL_DEV_SHOW_ALL;
const ZOHO_TRADE_PARTNERS_MODULE = env.ZOHO_TRADE_PARTNERS_MODULE;
const ZOHO_TRADE_PARTNER_RELATED_LIST = env.ZOHO_TRADE_PARTNER_RELATED_LIST;

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
const TRADE_PARTNER_DEALS_FIELD = 'Portal_Deals';
const TRADE_PARTNER_DEALS_FIELD_CANDIDATES = [
	'Portal_Deals',
	'Deals',
	'Portal_Deals1',
	'Portal_Deals2',
	'Portal_Deals3',
	'Related_Deals'
];
const TRADE_PARTNER_RELATED_LISTS = (ZOHO_TRADE_PARTNER_RELATED_LIST || 'Deals3')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);
// Candidate field names on the Deals module that may link to trade partners.
// The default is Portal_Trade_Partners, but some CRMs use different names.
const DEAL_TRADE_PARTNER_FIELD_CANDIDATES = [
	'Portal_Trade_Partners',
	'Trade_Partner',
	'Trade_Partners',
	'Vendor_Name',
	'Portal_Trade_Partner',
	'Trade_Partner_Name',
	'Subcontractor'
];

// Cache: resolved deal-side field name(s) pointing to trade partners.
let _resolvedDealTradePartnerFields: string[] | null = null;

/**
 * Discover which field(s) on the Deals module are lookups to the trade partners module.
 * Falls back to the hardcoded candidate list if metadata fetch fails.
 */
async function resolveDealTradePartnerFields(
	accessToken: string,
	apiDomain?: string
): Promise<string[]> {
	if (_resolvedDealTradePartnerFields) return _resolvedDealTradePartnerFields;

	const moduleNameSet = new Set(TRADE_PARTNERS_MODULES.map((m) => m.toLowerCase()));
	try {
		const response = await zohoApiCall(
			accessToken,
			'/settings/fields?module=Deals',
			{},
			apiDomain
		);
		const fields = (response.fields || response.data || []) as any[];
		const discovered: string[] = [];
		for (const field of fields) {
			const apiName = String(field?.api_name || field?.apiName || '').trim();
			if (!apiName) continue;
			// Check if this field is a lookup to one of the trade partner modules
			const lookupModule = String(
				field?.lookup?.module?.api_name ||
					field?.lookup?.module ||
					field?.lookup?.api_name ||
					''
			)
				.trim()
				.toLowerCase();
			if (lookupModule && moduleNameSet.has(lookupModule)) {
				discovered.push(apiName);
				continue;
			}
			// Also check multi-select lookup
			const multiModule = String(
				field?.multiselectlookup?.linking_module?.api_name ||
					field?.multiselectlookup?.linking_module ||
					''
			)
				.trim()
				.toLowerCase();
			if (multiModule && moduleNameSet.has(multiModule)) {
				discovered.push(apiName);
				continue;
			}
			// Check by name pattern if it explicitly references trade partners
			const lowerName = apiName.toLowerCase();
			if (
				(lowerName.includes('trade_partner') || lowerName.includes('trade_partners')) &&
				(field?.data_type === 'lookup' ||
					field?.data_type === 'multiselectlookup' ||
					field?.json_type === 'jsonobject' ||
					field?.json_type === 'jsonarray')
			) {
				discovered.push(apiName);
			}
		}
		if (discovered.length > 0) {
			log.debug('Discovered deal trade partner fields from metadata', {
				fields: discovered,
				apiDomain: apiDomain || 'default'
			});
			_resolvedDealTradePartnerFields = discovered;
			return discovered;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.debug('Deal field metadata fetch failed, using candidates', { error: message });
	}

	// Fallback to hardcoded candidates
	_resolvedDealTradePartnerFields = DEAL_TRADE_PARTNER_FIELD_CANDIDATES;
	return DEAL_TRADE_PARTNER_FIELD_CANDIDATES;
}

/**
 * Check if a deal's field value matches the given trade partner ID.
 */
function dealFieldMatchesTradePartner(fieldValue: any, tradePartnerId: string): boolean {
	if (!fieldValue) return false;
	if (Array.isArray(fieldValue)) {
		return fieldValue.some(
			(item) => item?.id === tradePartnerId || String(item) === tradePartnerId
		);
	}
	if (typeof fieldValue === 'object') {
		return fieldValue.id === tradePartnerId;
	}
	return String(fieldValue) === tradePartnerId;
}

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
 * Filter deals to only show those related to the authenticated trade partner
 */
export async function getTradePartnerDeals(accessToken: string, tradePartnerId: string, apiDomain?: string) {
	const perPage = 200;
	const maxPages = 20;
	let relatedDealIdsCount = 0;
	let relatedListCount = 0;
	let searchCount = 0;
	let coqlCount = 0;
	let fallbackCount = 0;
	// --- TEMPORARY DIAGNOSTICS (remove after debugging) ---
	const diag: string[] = [];
	const diagLog = (msg: string, data?: Record<string, unknown>) => {
		const line = data ? `${msg} ${JSON.stringify(data)}` : msg;
		diag.push(line);
		console.log(`[TRADE-DIAG] ${line}`);
	};
	// --- END DIAGNOSTICS ---
	const logSummary = (label: string, extra: Record<string, unknown> = {}) => {
		log.debug('trade partner deals lookup', {
			label,
			tradePartnerId,
			relatedDealIdsCount,
			relatedListCount,
			searchCount,
			coqlCount,
			fallbackCount,
			modules: TRADE_PARTNERS_MODULES,
			relatedLists: TRADE_PARTNER_RELATED_LISTS,
			apiDomain: apiDomain || 'default',
			...extra
		});
	};

	logSummary('start');
	diagLog('START getTradePartnerDeals', {
		tradePartnerId,
		modules: TRADE_PARTNERS_MODULES,
		relatedLists: TRADE_PARTNER_RELATED_LISTS,
		apiDomain: apiDomain || 'default'
	});

	const collected = new Map<string, any>();
	const collectedOrder: string[] = [];
	const rememberDeal = (deal: any) => {
		if (!deal || typeof deal !== 'object') return;
		const normalized = normalizeDealRecord(deal);
		const id = normalized?.id;
		if (!id) return;
		if (!collected.has(id)) {
			collectedOrder.push(id);
		}
		collected.set(id, normalized);
	};
	const rememberDeals = (deals: any[]) => {
		for (const deal of deals || []) {
			rememberDeal(deal);
		}
	};

	// 0) Try search endpoint for lookup field (direct Deals access)
	const dealTpFields = await resolveDealTradePartnerFields(accessToken, apiDomain);
	diagLog('Strategy 0: Deal search fields resolved', { dealTpFields });
	const searchOperators = ['equals', 'in'];
	for (const fieldName of dealTpFields) {
		for (const operator of searchOperators) {
			const criteria = `(${fieldName}:${operator}:${tradePartnerId})`;
			try {
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
				searchCount += searchResults.length;
				diagLog(`Strategy 0: Deal search result`, { fieldName, operator, criteria, found: searchResults.length });
				if (searchResults.length) {
					logSummary('search', { dealsCount: searchCount, operator, fieldName });
					rememberDeals(searchResults);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				diagLog(`Strategy 0: Deal search ERROR`, { fieldName, operator, criteria, error: message });
				if (message.includes('INVALID_QUERY') && message.includes('invalid operator')) {
					continue;
				}
				if (message.includes('INVALID_QUERY') || message.includes('invalid field')) {
					// This field name doesn't exist on the Deals module — skip it
					break;
				}
				log.error('Trade partner deals search failed', {
					tradePartnerId,
					criteria,
					operator,
					fieldName,
					error: message
				});
				break;
			}
		}
	}

	// 1) Try COQL if enabled — build queries for each discovered field name
	const coqlQueries: string[] = [];
	for (const fieldName of dealTpFields) {
		coqlQueries.push(
			`SELECT ${DEAL_FIELDS} FROM Deals WHERE ${fieldName} in ('${tradePartnerId}') ORDER BY Created_Time DESC`,
			`SELECT ${DEAL_FIELDS} FROM Deals WHERE ${fieldName}.id = '${tradePartnerId}' ORDER BY Created_Time DESC`,
			`SELECT ${DEAL_FIELDS} FROM Deals WHERE ${fieldName}.id in ('${tradePartnerId}') ORDER BY Created_Time DESC`
		);
	}
	for (const select_query of coqlQueries) {
		try {
			diagLog('Strategy 1: COQL attempt', { query: select_query });
			const response = await zohoApiCall(
				accessToken,
				'/coql',
				{
					method: 'POST',
					body: JSON.stringify({ select_query })
				},
				apiDomain
			);

			coqlCount += response.data?.length || 0;
			diagLog('Strategy 1: COQL result', { found: response.data?.length || 0, query: select_query });
			logSummary('coql', { dealsCount: coqlCount, query: select_query });
			if (response.data?.length) {
				rememberDeals(response.data);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			diagLog('Strategy 1: COQL ERROR', { error: message, query: select_query });
			if (message.includes('OAUTH_SCOPE_MISMATCH')) {
				log.error('Trade partner COQL failed', { tradePartnerId, error: message });
				break;
			}
			log.error('Trade partner COQL failed', { tradePartnerId, error: message, query: select_query });
		}
	}

	// 2) Try trade partner's related deals field if present
	let relatedDealRefs: TradePartnerDealRef[] = [];
	let relatedDealIds: string[] = [];
	try {
		diagLog('Strategy 2: Fetching TP deal IDs from record fields', { tradePartnerId });
		relatedDealRefs = await getTradePartnerDealIds(accessToken, tradePartnerId, apiDomain);
		relatedDealIdsCount = relatedDealRefs.length;
		relatedDealIds = relatedDealRefs.map((ref) => ref.id);
		diagLog('Strategy 2: TP deal IDs result', { found: relatedDealRefs.length, ids: relatedDealIds.slice(0, 10) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		diagLog('Strategy 2: TP deal IDs ERROR', { error: message });
		log.error('Trade partner deal IDs lookup failed', { tradePartnerId, error: message });
	}

	// 2b) DIAGNOSTIC: Fetch ALL fields from the trade partner record to see complete picture
	try {
		await diagFetchFullTradePartnerRecord(accessToken, tradePartnerId, diagLog, apiDomain);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		diagLog('DIAG TP RECORD: unexpected error', { error: message });
	}

	// 3) Try related list on trade partner record (may be a junction)
	let normalizedRelated: any[] = [];
	try {
		diagLog('Strategy 3: Fetching related list deals', { tradePartnerId, relatedLists: TRADE_PARTNER_RELATED_LISTS });
		const relatedDeals = await fetchDealsFromTradePartnerRelatedList(accessToken, tradePartnerId, apiDomain, diagLog);
		relatedListCount = relatedDeals.length;
		normalizedRelated = relatedDeals.map(normalizeDealRecord);
		diagLog('Strategy 3: Related list result', { found: relatedDeals.length });
		const sample = normalizedRelated[0];
		if (sample) {
			log.debug('related list raw sample', {
				keys: Object.keys(sample),
				dealName: sample?.Deal_Name,
				rawDealName: summarizeValue(sample?.Deal_Name)
			});
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		diagLog('Strategy 3: Related list ERROR', { error: message });
		log.error('Trade partner related list lookup failed', { tradePartnerId, error: message });
	}

	const relatedListIds = normalizedRelated.map((deal: any) => deal?.id).filter(Boolean) as string[];

	const combinedIds = Array.from(new Set([...relatedDealIds, ...relatedListIds]));
	diagLog('Strategies 2+3: Combined deal IDs', { count: combinedIds.length, ids: combinedIds.slice(0, 10) });
	if (combinedIds.length > 0) {
		try {
			const deals = await fetchDealsByIds(accessToken, combinedIds, apiDomain);
			diagLog('Strategies 2+3: Fetched deals by IDs', { requested: combinedIds.length, fetched: deals.length });
			logSummary('combinedIds', { dealsCount: deals.length, idsCount: combinedIds.length });
			rememberDeals(deals);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			diagLog('Strategies 2+3: Fetch by IDs ERROR', { error: message });
			log.error('Trade partner combined IDs fetch failed', { tradePartnerId, error: message });
		}
	}

	if (relatedDealRefs.length > 0) {
		for (const ref of relatedDealRefs) {
			if (ref?.id && !collected.has(ref.id)) {
				rememberDeal({
					id: ref.id,
					Deal_Name: ref.name || `Deal ${String(ref.id).slice(-6)}`,
					Portal_Trade_Partners: { id: tradePartnerId }
				});
			}
		}
	}
	if (normalizedRelated.length > 0) {
		for (const deal of normalizedRelated) {
			if (deal?.id && !collected.has(deal.id)) {
				rememberDeal(deal);
			}
		}
	}

	if (collectedOrder.length > 0) {
		diagLog('EARLY RETURN: Strategies 0-3 found deals', { totalCollected: collectedOrder.length });
		logSummary('final', { dealsCount: collectedOrder.length });
		return { deals: collectedOrder.map((id, index) => ensureDealId(collected.get(id), index)), diag };
	}

	// 4) Fallback to standard list + client-side filter
	try {
		diagLog('Strategy 4: Fallback - scanning all deals', { tradePartnerId, dealTpFields });
		const filtered: any[] = [];
		let totalScanned = 0;
		let nonNullSamplesLogged = 0;
		let firstDealFieldsLogged = false;
		for (let page = 1; page <= maxPages; page += 1) {
			const deals = await zohoApiCall(
				accessToken,
				`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=${perPage}&page=${page}`,
				{},
				apiDomain
			);
			const pageData = Array.isArray(deals.data) ? deals.data : [];
			if (pageData.length === 0) break;
			totalScanned += pageData.length;

			// --- ENHANCED DIAGNOSTICS: log trade/partner/vendor fields on first deal ---
			if (!firstDealFieldsLogged && pageData.length > 0) {
				firstDealFieldsLogged = true;
				const firstDeal = pageData[0];
				const allKeys = Object.keys(firstDeal);
				const tradePartnerKeys = allKeys.filter((k) =>
					/trade|partner|vendor|subcontract/i.test(k)
				);
				diagLog('Strategy 4: FIRST DEAL - all field names containing trade/partner/vendor/subcontract', {
					matchingKeys: tradePartnerKeys,
					totalFieldCount: allKeys.length,
					allKeys: allKeys
				});
				// Log the values of those matching fields
				for (const key of tradePartnerKeys) {
					const val = firstDeal[key];
					diagLog(`Strategy 4: FIRST DEAL field "${key}"`, {
						type: val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val,
						value: summarizeValue(val, 1000)
					});
				}
			}

			for (const deal of pageData) {
				let matched = false;
				for (const fieldName of dealTpFields) {
					if (dealFieldMatchesTradePartner(deal[fieldName], tradePartnerId)) {
						matched = true;
						break;
					}
				}

				// --- ENHANCED DIAGNOSTICS: log raw field values for first 5 deals with non-null trade partner fields ---
				if (nonNullSamplesLogged < 5) {
					for (const fieldName of dealTpFields) {
						const val = deal[fieldName];
						if (val !== null && val !== undefined && val !== '') {
							nonNullSamplesLogged++;
							diagLog(`Strategy 4: SAMPLE DEAL with non-null "${fieldName}"`, {
								dealId: deal.id,
								dealName: deal.Deal_Name,
								fieldName,
								valueType: val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val,
								rawValue: summarizeValue(val, 1000),
								isArray: Array.isArray(val),
								isObject: typeof val === 'object' && !Array.isArray(val),
								matchResult: dealFieldMatchesTradePartner(val, tradePartnerId),
								tradePartnerId
							});
							// If it's an array, log the first element's structure
							if (Array.isArray(val) && val.length > 0) {
								const first = val[0];
								diagLog(`Strategy 4: SAMPLE DEAL array[0] structure for "${fieldName}"`, {
									dealId: deal.id,
									elementType: first === null ? 'null' : Array.isArray(first) ? 'array' : typeof first,
									elementKeys: first && typeof first === 'object' ? Object.keys(first) : [],
									elementRaw: summarizeValue(first, 1000),
									elementId: first?.id,
									elementName: first?.name,
									elementDisplayValue: first?.display_value
								});
							}
							// If it's an object (not array), log its keys and id
							if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
								diagLog(`Strategy 4: SAMPLE DEAL object structure for "${fieldName}"`, {
									dealId: deal.id,
									keys: Object.keys(val),
									id: val.id,
									name: val.name,
									displayValue: val.display_value,
									raw: summarizeValue(val, 1000)
								});
							}
							break; // Only log one field per deal
						}
					}
				}

				if (matched) {
					filtered.push(deal);
				}
			}

			const hasMore = deals.info?.more_records;
			if (hasMore === false) break;
			if (hasMore !== true && pageData.length < perPage) break;
		}

		if (nonNullSamplesLogged === 0) {
			diagLog('Strategy 4: WARNING - ALL deals have null/empty trade partner fields across all checked fields', {
				fieldsChecked: dealTpFields,
				totalScanned
			});
		}

		fallbackCount = filtered.length;
		diagLog('Strategy 4: Fallback result', { scanned: totalScanned, matched: filtered.length, nonNullSamples: nonNullSamplesLogged });
		logSummary('fallback', { dealsCount: fallbackCount });

		if (filtered.length === 0) {
			diagLog('ALL STRATEGIES EXHAUSTED: Zero deals found', {
				tradePartnerId,
				searchCount,
				coqlCount,
				relatedDealIdsCount,
				relatedListCount,
				fallbackCount
			});
			log.warn('Trade partner deals empty', {
				tradePartnerId,
				relatedDealIdsCount,
				relatedListCount,
				searchCount,
				coqlCount,
				fallbackCount
			});
		}

		return { deals: filtered.map(normalizeDealRecord).map(ensureDealId), diag };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		diagLog('Strategy 4: Fallback ERROR', { error: message });
		log.error('Trade partner deals fallback scan failed', { tradePartnerId, error: message });
		return { deals: [], diag };
	}
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
	const moduleNames = TRADE_PARTNERS_MODULES.length ? TRADE_PARTNERS_MODULES : ['CustomModule1'];
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
			if (!record) return null;
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
			if (message.toLowerCase().includes('record not found')) {
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

type TradePartnerDealRef = { id: string; name?: string | null };

function summarizeValue(value: any, limit = 400) {
	try {
		const str = JSON.stringify(value);
		if (!str) return null;
		return str.length > limit ? `${str.slice(0, limit)}…` : str;
	} catch {
		return String(value);
	}
}

function extractDealRefFromPortalItem(item: any): TradePartnerDealRef | null {
	if (!item) return null;
	if (typeof item === 'string') return { id: item };
	if (typeof item !== 'object') return null;

	const nested = item[TRADE_PARTNER_DEALS_FIELD];
	if (Array.isArray(nested) && nested.length > 0) {
		const first = nested[0];
		const id = first?.id || first?.ID || first?.Id;
		if (id) {
			const name =
				first?.name ||
				first?.display_value ||
				first?.displayValue ||
				first?.value ||
				null;
			return { id, name };
		}
	}
	if (nested && typeof nested === 'object') {
		const id = nested.id || nested.ID || nested.Id;
		if (id) {
			const name =
				nested.name ||
				nested.display_value ||
				nested.displayValue ||
				nested.value ||
				null;
			return { id, name };
		}
	}

	const id = item.id || item.Id || item.ID;
	if (!id) return null;
	const name = item.name || item.display_value || item.displayValue || item.value || null;
	return { id, name };
}

async function getTradePartnerDealIds(
	accessToken: string,
	tradePartnerId: string,
	apiDomain?: string
): Promise<TradePartnerDealRef[]> {
	const fieldCandidates = TRADE_PARTNER_DEALS_FIELD_CANDIDATES;
	const fieldsParam = fieldCandidates.join(',');
	for (const moduleName of TRADE_PARTNERS_MODULES) {
		try {
			const response = await zohoApiCall(
				accessToken,
				`/${moduleName}/${tradePartnerId}?fields=${encodeURIComponent(fieldsParam)}`,
				{},
				apiDomain
			);
			const record = response.data?.[0];
			if (!record) {
				log.debug('trade partner record not found', {
					moduleName,
					tradePartnerId,
					apiDomain: apiDomain || 'default'
				});
				return [];
			}

			// Try each candidate field until one has data
			for (const candidateField of fieldCandidates) {
				const fieldValue = record[candidateField];
				if (!fieldValue) continue;

				if (Array.isArray(fieldValue)) {
					const refs = fieldValue.map(extractDealRefFromPortalItem).filter(Boolean) as TradePartnerDealRef[];
					log.debug('trade partner deals field array', {
						moduleName,
						tradePartnerId,
						field: candidateField,
						idsCount: refs.length,
						apiDomain: apiDomain || 'default'
					});
					if (refs.length > 0) {
						const sample = fieldValue[0];
						log.debug('trade partner deals field sample', {
							keys: sample ? Object.keys(sample) : [],
							id: sample?.id,
							name: sample?.name,
							display_value: sample?.display_value,
							nested_id: sample?.[candidateField]?.id,
							nested_name: sample?.[candidateField]?.name,
							nested_summary: summarizeValue(sample?.[candidateField])
						});
						return refs;
					}
				}
				if (fieldValue?.id) {
					log.debug('trade partner deals field lookup', {
						moduleName,
						tradePartnerId,
						field: candidateField,
						apiDomain: apiDomain || 'default'
					});
					return [{ id: fieldValue.id, name: fieldValue.name || null }];
				}
			}

			log.debug('trade partner deals fields all empty', {
				moduleName,
				tradePartnerId,
				candidateFields: fieldCandidates,
				recordKeys: Object.keys(record),
				apiDomain: apiDomain || 'default'
			});
			return [];
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.toLowerCase().includes('module name given seems to be invalid')) {
				log.debug('trade partner module invalid', {
					moduleName,
					tradePartnerId,
					apiDomain: apiDomain || 'default'
				});
				continue;
			}
			log.error('Trade partner deal ids lookup failed', {
				moduleName,
				tradePartnerId,
				error: message
			});
			throw err;
		}
	}

	return [];
}

/**
 * TEMPORARY DIAGNOSTIC: Fetch ALL fields from the trade partner record and log them.
 * This helps identify how deals are linked when standard fields are empty.
 */
async function diagFetchFullTradePartnerRecord(
	accessToken: string,
	tradePartnerId: string,
	diagLog: (msg: string, data?: Record<string, unknown>) => void,
	apiDomain?: string
): Promise<void> {
	for (const moduleName of TRADE_PARTNERS_MODULES) {
		try {
			// Fetch without fields param to get ALL fields
			const response = await zohoApiCall(
				accessToken,
				`/${moduleName}/${tradePartnerId}`,
				{},
				apiDomain
			);
			const record = response.data?.[0];
			if (!record) {
				diagLog('DIAG TP RECORD: not found', { moduleName, tradePartnerId });
				continue;
			}

			const allKeys = Object.keys(record);
			diagLog('DIAG TP RECORD: all field names', {
				moduleName,
				tradePartnerId,
				totalFields: allKeys.length,
				allKeys
			});

			// Log fields that look deal-related
			const dealRelatedKeys = allKeys.filter((k) =>
				/deal|potential|project|portal|related|lookup|subform/i.test(k)
			);
			diagLog('DIAG TP RECORD: deal/portal/related field names', {
				matchingKeys: dealRelatedKeys
			});

			// Log the values of deal-related fields
			for (const key of dealRelatedKeys) {
				const val = record[key];
				diagLog(`DIAG TP RECORD field "${key}"`, {
					type: val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val,
					value: summarizeValue(val, 1000),
					isArray: Array.isArray(val),
					arrayLength: Array.isArray(val) ? val.length : undefined,
					objectKeys: val && typeof val === 'object' && !Array.isArray(val) ? Object.keys(val) : undefined
				});
				// If array, log first element structure
				if (Array.isArray(val) && val.length > 0) {
					diagLog(`DIAG TP RECORD field "${key}" array[0]`, {
						elementType: typeof val[0],
						elementKeys: val[0] && typeof val[0] === 'object' ? Object.keys(val[0]) : [],
						elementRaw: summarizeValue(val[0], 1000)
					});
				}
			}

			// Also log ALL non-null field values (truncated) for complete picture
			const nonNullFields: Record<string, unknown> = {};
			for (const key of allKeys) {
				const val = record[key];
				if (val !== null && val !== undefined && val !== '' && val !== false) {
					nonNullFields[key] = summarizeValue(val, 200);
				}
			}
			diagLog('DIAG TP RECORD: all non-null field values', nonNullFields);

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			diagLog('DIAG TP RECORD: fetch ERROR', { moduleName, tradePartnerId, error: message });
		}
	}
}

async function fetchDealsFromTradePartnerRelatedList(
	accessToken: string,
	tradePartnerId: string,
	apiDomain?: string,
	diagLog?: (msg: string, data?: Record<string, unknown>) => void
): Promise<any[]> {
	const perPage = 200;
	const baseRelatedLists = TRADE_PARTNER_RELATED_LISTS.length
		? TRADE_PARTNER_RELATED_LISTS
		: ['Deals', TRADE_PARTNER_DEALS_FIELD];
	// Add common related list names as fallbacks (deduplicated)
	const relatedListSet = new Set(baseRelatedLists);
	for (const name of ['Deals', 'Deals1', 'Deals2', 'Deals3', 'Deals4', 'Portal_Deals', 'Potentials']) {
		relatedListSet.add(name);
	}
	const relatedLists = Array.from(relatedListSet);
	for (const moduleName of TRADE_PARTNERS_MODULES) {
		for (const relatedList of relatedLists) {
			try {
				let page = 1;
				let more = true;
				const results: any[] = [];

				while (more) {
					const response = await zohoApiCall(
						accessToken,
						`/${moduleName}/${tradePartnerId}/${relatedList}?page=${page}&per_page=${perPage}`,
						{},
						apiDomain
					);
					const deals = response.data || [];
					results.push(...deals);
					more = Boolean(response.info?.more_records);
					page += 1;
				}

				log.debug('trade partner related list', {
					moduleName,
					tradePartnerId,
					relatedList,
					dealsCount: results.length,
					apiDomain: apiDomain || 'default'
				});
				diagLog?.(`Strategy 3: Related list "${relatedList}" on ${moduleName}`, {
					found: results.length,
					sampleKeys: results[0] ? Object.keys(results[0]) : [],
					sampleRaw: results[0] ? summarizeValue(results[0], 1000) : null
				});

				if (results.length > 0) return results;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				diagLog?.(`Strategy 3: Related list "${relatedList}" on ${moduleName} ERROR`, { error: message });
				if (message.toLowerCase().includes('module name given seems to be invalid')) {
					log.debug('trade partner module invalid for related list', {
						moduleName,
						tradePartnerId,
						apiDomain: apiDomain || 'default'
					});
					break; // Skip this module entirely
				}
				// Log and try the next related list name
				log.debug('trade partner related list failed', {
					moduleName,
					tradePartnerId,
					relatedList,
					error: message
				});
			}
		}
	}

	return [];
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
