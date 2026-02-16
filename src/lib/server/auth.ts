import { zohoApiCall } from './zoho';
import type { Client } from './db';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

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
const TRADE_PARTNER_RELATED_LISTS = (ZOHO_TRADE_PARTNER_RELATED_LIST || 'Deals3')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

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

	return {
		zoho_contact_id: contact.id,
		email: contact.Email,
		first_name: firstName,
		last_name: lastName,
		full_name: fullName,
		company: contact.Account_Name?.name || null,
		phone: contact.Phone || null
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
 * Find Zoho contact by email (admin token)
 */
export async function findContactByEmail(accessToken: string, email: string, apiDomain?: string): Promise<ClientProfile | null> {
	const search = await zohoApiCall(
		accessToken,
		`/Contacts/search?email=${encodeURIComponent(email)}&fields=${encodeURIComponent(CONTACT_FIELDS)}`,
		{},
		apiDomain
	);

	const contact = search.data?.[0];
	if (!contact) return null;
	return mapContact(contact);
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
		console.error('Failed to get authenticated contact:', error);
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
		console.warn('Deals search failed, falling back to COQL');
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
		console.warn('COQL query failed, falling back to standard API');
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
	let relatedDealIdsCount = 0;
	let relatedListCount = 0;
	let searchCount = 0;
	let coqlCount = 0;
	let fallbackCount = 0;
	const logSummary = (label: string, extra: Record<string, unknown> = {}) => {
		console.error('TP_DEBUG: trade partner deals lookup', {
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
	const searchOperators = ['equals', 'in'];
	for (const operator of searchOperators) {
		const criteria = `(Portal_Trade_Partners:${operator}:${tradePartnerId})`;
		try {
			const search = await zohoApiCall(
				accessToken,
				`/Deals/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=200`,
				{},
				apiDomain
			);
			searchCount = search.data?.length || 0;
			if (search.data?.length) {
				logSummary('search', { dealsCount: searchCount, operator });
				rememberDeals(search.data);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('INVALID_QUERY') && message.includes('invalid operator')) {
				continue;
			}
			console.error('Trade partner deals search failed', {
				tradePartnerId,
				criteria,
				operator,
				error: message
			});
			break;
		}
	}

	// 1) Try COQL if enabled
	const coqlQueries = [
		`SELECT ${DEAL_FIELDS} FROM Deals WHERE Portal_Trade_Partners in ('${tradePartnerId}') ORDER BY Created_Time DESC`,
		`SELECT ${DEAL_FIELDS} FROM Deals WHERE Portal_Trade_Partners.id = '${tradePartnerId}' ORDER BY Created_Time DESC`,
		`SELECT ${DEAL_FIELDS} FROM Deals WHERE Portal_Trade_Partners.id in ('${tradePartnerId}') ORDER BY Created_Time DESC`
	];
	for (const select_query of coqlQueries) {
		try {
			const response = await zohoApiCall(
				accessToken,
				'/coql',
				{
					method: 'POST',
					body: JSON.stringify({ select_query })
				},
				apiDomain
			);

			coqlCount = response.data?.length || 0;
			logSummary('coql', { dealsCount: coqlCount, query: select_query });
			if (response.data?.length) {
				rememberDeals(response.data);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('OAUTH_SCOPE_MISMATCH')) {
				console.error('Trade partner COQL failed', { tradePartnerId, error: message });
				break;
			}
			console.error('Trade partner COQL failed', { tradePartnerId, error: message, query: select_query });
		}
	}

	// 2) Try trade partner's related deals field if present
	const relatedDealRefs = await getTradePartnerDealIds(accessToken, tradePartnerId, apiDomain);
	relatedDealIdsCount = relatedDealRefs.length;
	const relatedDealIds = relatedDealRefs.map((ref) => ref.id);

	// 3) Try related list on trade partner record (may be a junction)
	const relatedDeals = await fetchDealsFromTradePartnerRelatedList(accessToken, tradePartnerId, apiDomain);
	relatedListCount = relatedDeals.length;
	const normalizedRelated = relatedDeals.map(normalizeDealRecord);
	const sample = normalizedRelated[0];
	if (sample) {
		console.error('TP_DEBUG: related list raw sample', {
			keys: Object.keys(sample),
			dealName: sample?.Deal_Name,
			rawDealName: summarizeValue(sample?.Deal_Name)
		});
	}
	const relatedListIds = normalizedRelated.map((deal: any) => deal?.id).filter(Boolean) as string[];

	const combinedIds = Array.from(new Set([...relatedDealIds, ...relatedListIds]));
	if (combinedIds.length > 0) {
		const deals = await fetchDealsByIds(accessToken, combinedIds, apiDomain);
		logSummary('combinedIds', { dealsCount: deals.length, idsCount: combinedIds.length });
		rememberDeals(deals);
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
		logSummary('final', { dealsCount: collectedOrder.length });
		return collectedOrder.map((id, index) => ensureDealId(collected.get(id), index));
	}

	// 4) Fallback to standard list + client-side filter
	const deals = await zohoApiCall(
		accessToken,
		`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=200`,
		{},
		apiDomain
	);

	const filtered = (deals.data || []).filter((deal: any) => {
		const field = deal.Portal_Trade_Partners;
		if (Array.isArray(field)) {
			return field.some((item) => item?.id === tradePartnerId);
		}
		return field?.id === tradePartnerId;
	});

	fallbackCount = filtered.length;
	logSummary('fallback', { dealsCount: fallbackCount });

	if (filtered.length === 0) {
		console.warn('Trade partner deals empty', {
			tradePartnerId,
			relatedDealIdsCount,
			relatedListCount,
			searchCount,
			coqlCount,
			fallbackCount
		});
	}

	return filtered.map(normalizeDealRecord).map(ensureDealId);
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
		console.warn('Trade partner field metadata fetch failed', { moduleName, error: message });
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
			console.warn('Failed to fetch trade partner', { moduleName, id, error: err });
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
					console.warn('Trade partner email recovery', {
						moduleName,
						recovered,
						remainingMissing: missingEmail
					});
				}
			}

			if (missingEmail > 0) {
				console.warn('Trade partner records missing email', {
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
					console.warn('Failed to fetch contact', id, err);
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
		console.error('TP_DEBUG: fetch deals by ids', {
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
					console.error('TP_DEBUG: deal id fetch failed', {
						dealId: id,
						apiDomain: apiDomain || 'default',
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			console.error('TP_DEBUG: fetch deals by id fallback', {
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
					console.error('TP_DEBUG: fetch deals by id search', {
						chunkSize: chunk.length,
						dealsCount: searchDeals.length,
						apiDomain: apiDomain || 'default'
					});
					results.push(...searchDeals);
				} catch (error) {
					console.error('TP_DEBUG: deal id search failed', {
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
	for (const moduleName of TRADE_PARTNERS_MODULES) {
		try {
			const response = await zohoApiCall(
				accessToken,
				`/${moduleName}/${tradePartnerId}?fields=${encodeURIComponent(TRADE_PARTNER_DEALS_FIELD)}`,
				{},
				apiDomain
			);
			const record = response.data?.[0];
			const fieldValue = record?.[TRADE_PARTNER_DEALS_FIELD];
			if (!fieldValue) {
				console.error('TP_DEBUG: trade partner deals field empty', {
					moduleName,
					tradePartnerId,
					field: TRADE_PARTNER_DEALS_FIELD,
					apiDomain: apiDomain || 'default'
				});
				return [];
			}
			if (Array.isArray(fieldValue)) {
				const refs = fieldValue.map(extractDealRefFromPortalItem).filter(Boolean) as TradePartnerDealRef[];
				console.error('TP_DEBUG: trade partner deals field array', {
					moduleName,
					tradePartnerId,
					field: TRADE_PARTNER_DEALS_FIELD,
					idsCount: refs.length,
					apiDomain: apiDomain || 'default'
				});
				if (refs.length > 0) {
					const sample = fieldValue[0];
					console.error('TP_DEBUG: trade partner deals field sample', {
						keys: sample ? Object.keys(sample) : [],
						id: sample?.id,
						name: sample?.name,
						display_value: sample?.display_value,
						nested_id: sample?.[TRADE_PARTNER_DEALS_FIELD]?.id,
						nested_name: sample?.[TRADE_PARTNER_DEALS_FIELD]?.name,
						nested_summary: summarizeValue(sample?.[TRADE_PARTNER_DEALS_FIELD])
					});
				}
				return refs;
			}
			if (fieldValue?.id) {
				console.error('TP_DEBUG: trade partner deals field lookup', {
					moduleName,
					tradePartnerId,
					field: TRADE_PARTNER_DEALS_FIELD,
					apiDomain: apiDomain || 'default'
				});
				return [{ id: fieldValue.id, name: fieldValue.name || null }];
			}
			console.warn('Trade partner deals field unexpected shape', {
				moduleName,
				tradePartnerId,
				field: TRADE_PARTNER_DEALS_FIELD,
				keys: record ? Object.keys(record) : []
			});
			return [];
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.toLowerCase().includes('module name given seems to be invalid')) {
				console.error('TP_DEBUG: trade partner module invalid', {
					moduleName,
					tradePartnerId,
					apiDomain: apiDomain || 'default'
				});
				continue;
			}
			console.error('Trade partner deal ids lookup failed', {
				moduleName,
				tradePartnerId,
				error: message
			});
			throw err;
		}
	}

	return [];
}

async function fetchDealsFromTradePartnerRelatedList(
	accessToken: string,
	tradePartnerId: string,
	apiDomain?: string
): Promise<any[]> {
	const perPage = 200;
	const relatedLists = TRADE_PARTNER_RELATED_LISTS.length
		? TRADE_PARTNER_RELATED_LISTS
		: ['Deals', TRADE_PARTNER_DEALS_FIELD];
	for (const moduleName of TRADE_PARTNERS_MODULES) {
		try {
			for (const relatedList of relatedLists) {
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

				console.error('TP_DEBUG: trade partner related list', {
					moduleName,
					tradePartnerId,
					relatedList,
					dealsCount: results.length,
					apiDomain: apiDomain || 'default'
				});

				if (results.length > 0) return results;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.toLowerCase().includes('module name given seems to be invalid')) {
				console.error('TP_DEBUG: trade partner module invalid for related list', {
					moduleName,
					tradePartnerId,
					apiDomain: apiDomain || 'default'
				});
				continue;
			}
			console.error('Trade partner related list fetch failed', {
				moduleName,
				tradePartnerId,
				relatedLists,
				error: message
			});
			// If related list isn't supported, fall through.
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
