import { zohoApiCall } from './zoho';
import type { Client } from './db';
import { dev } from '$app/environment';
import {
	PORTAL_DEV_SHOW_ALL,
	ZOHO_TRADE_PARTNERS_MODULE,
	ZOHO_TRADE_PARTNER_RELATED_LIST
} from '$env/static/private';

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
	'Notes1',
	'External_Link',
	'Portal_Trade_Partners'
].join(',');

const CONTACT_FIELDS = [
	'First_Name',
	'Last_Name',
	'Full_Name',
	'Email',
	'Phone',
	'Account_Name'
].join(',');

const TRADE_PARTNER_FIELDS = [
	'Name',
	'Last_Name',
	'Business_Name',
	'Email',
	'Secondary_Email',
	'Phone',
	'Phone1'
].join(',');

const TRADE_PARTNERS_MODULES = (ZOHO_TRADE_PARTNERS_MODULE || 'Trade_Partners')
	.split(',')
	.map((name) => name.trim())
	.filter(Boolean);
const TRADE_PARTNER_DEALS_FIELD = 'Portal_Deals';
const TRADE_PARTNER_RELATED_LISTS = (ZOHO_TRADE_PARTNER_RELATED_LIST || 'Deals3')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

const ACTIVE_DEAL_STAGES = new Set([
	'ballpark needed',
	'ballpark',
	'revision',
	'ballpark review needed',
	'ballpark review booked',
	'pda needed',
	'pda sent',
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

function isActiveDealStage(stage: string | null | undefined) {
	if (!stage) return false;
	return ACTIVE_DEAL_STAGES.has(stage.trim().toLowerCase());
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

function mapTradePartner(record: any): TradePartnerProfile | null {
	const email =
		pickFirst(record, ['Email', 'Secondary_Email', 'Email_1', 'Email_Address', 'Email_Address_1']) ||
		null;
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

function normalizeDealRecord(deal: any) {
	if (!deal || typeof deal !== 'object') return deal;
	const id =
		deal.id ||
		deal.Deal?.id ||
		deal.Deal_ID ||
		deal.deal_id ||
		deal?.Deal_Name?.id ||
		deal?.Potential_Name?.id;
	const name =
		extractDisplayValue(deal.Deal_Name) ||
		extractDisplayValue(deal.Potential_Name) ||
		extractDisplayValue(deal.Name) ||
		extractDisplayValue(deal.name) ||
		extractDisplayValue(deal.Subject) ||
		extractDisplayValue(deal.Full_Name) ||
		extractDisplayValue(deal.Display_Name) ||
		extractDisplayValue(deal.display_name) ||
		(id ? `Deal ${String(id).slice(-6)}` : null);
	const normalized = { ...deal };
	if (!normalized.id && id) normalized.id = id;
	if (!normalized.Deal_Name && name) normalized.Deal_Name = name;

	const textFields = [
		'Address',
		'Address_Line_2',
		'Street',
		'City',
		'State',
		'Zip_Code',
		'Garage_Code',
		'WiFi',
		'Notes1',
		'Stage'
	];
	for (const field of textFields) {
		const current = normalized[field];
		if (current && typeof current === 'string') continue;
		const coerced = coerceText(current);
		if (coerced) normalized[field] = coerced;
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
	// 1) Try search endpoint (most reliable without COQL)
	try {
		const criteria = `(Contact_Name:equals:${contactId})`;
		const search = await zohoApiCall(
			accessToken,
			`/Deals/search?criteria=${encodeURIComponent(criteria)}&fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=200`,
			{},
			apiDomain
		);
		if (search.data?.length) return search.data;
	} catch (error) {
		console.warn('Deals search failed, falling back to COQL');
	}

	// 2) Try COQL if enabled
	try {
		const query = {
			select_query: `SELECT ${DEAL_FIELDS} FROM Deals WHERE Contact_Name = '${contactId}' ORDER BY Created_Time DESC`
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

		if (response.data?.length) return response.data;
	} catch (error) {
		console.warn('COQL query failed, falling back to standard API');
	}

	// 3) Fallback to standard list + client-side filter
	const deals = await zohoApiCall(
		accessToken,
		`/Deals?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=200`,
		{},
		apiDomain
	);

	const filtered = (deals.data || []).filter((deal: any) => deal.Contact_Name?.id === contactId);

	if (filtered.length === 0 && dev && PORTAL_DEV_SHOW_ALL === 'true') {
		return deals.data || [];
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
				return search.data.map(normalizeDealRecord).map(ensureDealId);
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
	try {
		const query = {
			select_query: `SELECT ${DEAL_FIELDS} FROM Deals WHERE Portal_Trade_Partners in ('${tradePartnerId}') ORDER BY Created_Time DESC`
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

		coqlCount = response.data?.length || 0;
		if (response.data?.length) {
			logSummary('coql', { dealsCount: coqlCount });
			return response.data.map(normalizeDealRecord).map(ensureDealId);
		}
	} catch (error) {
		console.error('Trade partner COQL failed', {
			tradePartnerId,
			error: error instanceof Error ? error.message : String(error)
		});
	}

	// 2) Try trade partner's related deals field if present
	const relatedDealRefs = await getTradePartnerDealIds(accessToken, tradePartnerId, apiDomain);
	relatedDealIdsCount = relatedDealRefs.length;
	if (relatedDealRefs.length > 0) {
		const relatedDealIds = relatedDealRefs.map((ref) => ref.id);
		const deals = await fetchDealsByIds(accessToken, relatedDealIds, apiDomain);
		logSummary('relatedDealIds', { dealsCount: deals.length });
		if (deals.length > 0) {
			return deals.map(normalizeDealRecord).map(ensureDealId);
		}
		console.error('TP_DEBUG: related deal ids returned, but deals fetch empty', {
			tradePartnerId,
			relatedDealIdsCount,
			apiDomain: apiDomain || 'default'
		});
		const fallbackDeals = relatedDealRefs.map((ref) => ({
			id: ref.id,
			Deal_Name: ref.name || `Deal ${String(ref.id).slice(-6)}`,
			Portal_Trade_Partners: { id: tradePartnerId }
		}));
		if (fallbackDeals.length > 0) {
			logSummary('relatedDealIdsFallback', { dealsCount: fallbackDeals.length });
			return fallbackDeals.map(normalizeDealRecord).map(ensureDealId);
		}
	}

	// 3) Try related list on trade partner record (may be a junction)
	const relatedDeals = await fetchDealsFromTradePartnerRelatedList(accessToken, tradePartnerId, apiDomain);
	relatedListCount = relatedDeals.length;
	if (relatedDeals.length > 0) {
		const normalizedRelated = relatedDeals.map(normalizeDealRecord);
		const relatedIds = normalizedRelated.map((deal: any) => deal?.id).filter(Boolean) as string[];
		let hydratedDeals = normalizedRelated;
		let hydratedCount = 0;
		if (relatedIds.length > 0) {
			const hydrated = await fetchDealsByIds(accessToken, relatedIds, apiDomain);
			hydratedCount = hydrated.length;
			if (hydrated.length > 0) {
				const normalizedHydrated = hydrated.map(normalizeDealRecord);
				const hydratedMap = new Map(normalizedHydrated.map((deal: any) => [deal.id, deal]));
				hydratedDeals = normalizedRelated.map((deal: any) => hydratedMap.get(deal.id) || deal);
			}
		}
		logSummary('relatedList', {
			dealsCount: relatedDeals.length,
			hydratedCount,
			missingIds: Math.max(relatedDeals.length - relatedIds.length, 0)
		});
		if (normalizedRelated.length > 0) {
			const sample = normalizedRelated[0];
			console.error('TP_DEBUG: related list sample', {
				keys: Object.keys(sample || {}),
				id: sample?.id,
				dealName: sample?.Deal_Name
			});
		}
		return hydratedDeals.map(normalizeDealRecord).map(ensureDealId);
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

/**
 * Fetch all Trade Partners from Zoho (Custom Module)
 */
export async function listTradePartners(accessToken: string, apiDomain?: string): Promise<TradePartnerProfile[]> {
	const perPage = 200;
	const moduleNames = TRADE_PARTNERS_MODULES.length ? TRADE_PARTNERS_MODULES : ['CustomModule1'];
	let lastError: Error | null = null;

	for (const moduleName of moduleNames) {
		try {
			let page = 1;
			let more = true;
			const results: TradePartnerProfile[] = [];

			while (more) {
				const response = await zohoApiCall(
					accessToken,
					`/${moduleName}?fields=${encodeURIComponent(TRADE_PARTNER_FIELDS)}&page=${page}&per_page=${perPage}`,
					{},
					apiDomain
				);

				const records = response.data || [];
				for (const record of records) {
					const mapped = mapTradePartner(record);
					if (mapped) results.push(mapped);
				}

				more = Boolean(response.info?.more_records);
				page += 1;
			}

			return results;
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

async function listActiveDealContactIds(accessToken: string, apiDomain?: string): Promise<string[]> {
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
			if (!isActiveDealStage(stage)) continue;
			const contactId = deal.Contact_Name?.id;
			if (contactId) ids.add(contactId);
		}

		more = Boolean(response.info?.more_records);
		page += 1;
	}

	return Array.from(ids);
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
		}
	}
	return results;
}

type TradePartnerDealRef = { id: string; name?: string | null };

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
				const refs = fieldValue
					.map((item) => {
						if (!item) return null;
						if (typeof item === 'string') {
							return { id: item };
						}
						const id = item.id || item.Id || item.ID;
						if (!id) return null;
						const name = item.name || item.display_value || item.displayValue || item.value || null;
						return { id, name };
					})
					.filter(Boolean) as TradePartnerDealRef[];
				console.error('TP_DEBUG: trade partner deals field array', {
					moduleName,
					tradePartnerId,
					field: TRADE_PARTNER_DEALS_FIELD,
					idsCount: refs.length,
					apiDomain: apiDomain || 'default'
				});
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
						`/${moduleName}/${tradePartnerId}/${relatedList}?fields=${encodeURIComponent(
							DEAL_FIELDS
						)}&page=${page}&per_page=${perPage}`,
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
	const contactIds = await listActiveDealContactIds(accessToken, apiDomain);
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
