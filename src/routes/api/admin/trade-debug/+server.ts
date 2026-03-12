import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens, supabase } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fb = new Date(fallback as any);
		if (!Number.isNaN(fb.getTime())) return fb.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho is not connected yet.');

	let accessToken = tokens.access_token;
	const apiDomain = (tokens as any).api_domain || undefined;

	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain };
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const errors: string[] = [];

	let accessToken: string;
	let apiDomain: string | undefined;
	try {
		const result = await getAccessToken();
		accessToken = result.accessToken;
		apiDomain = result.apiDomain;
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Failed to get Zoho token' }, { status: 500 });
	}

	// Run all diagnostics in parallel
	const [modulesResult, fieldsResult, dealsResult, tradePartnersResult] = await Promise.allSettled([
		// 1) Zoho modules
		zohoApiCall(accessToken, '/settings/modules', {}, apiDomain),
		// 2) Deals field metadata
		zohoApiCall(accessToken, '/settings/fields?module=Deals', {}, apiDomain),
		// 3) Fetch 3 deals with ALL fields (no fields param)
		zohoApiCall(accessToken, '/Deals?page=1&per_page=3', {}, apiDomain),
		// 4) Supabase trade_partners table
		supabase
			.from('trade_partners')
			.select('id, zoho_trade_partner_id, email, name, company, phone, created_at, updated_at')
			.order('updated_at', { ascending: false })
			.limit(50)
	]);

	// Process modules
	let modules: any = null;
	if (modulesResult.status === 'fulfilled') {
		const raw = modulesResult.value;
		const allModules = (raw.modules || raw.data || []) as any[];
		const names = allModules.map((m: any) => String(m?.api_name || '')).filter(Boolean);
		const tradeRelated = names.filter((n: string) => /trade|partner|vendor|subcontract/i.test(n));
		const customModules = allModules
			.filter((m: any) => m?.generated_type === 'custom' || m?.custom_module === true)
			.map((m: any) => ({
				api_name: m?.api_name,
				singular_label: m?.singular_label,
				plural_label: m?.plural_label,
				generated_type: m?.generated_type
			}));
		modules = { total: names.length, allNames: names, tradeRelated, customModules };
	} else {
		errors.push(`Modules API error: ${modulesResult.reason}`);
		modules = { error: String(modulesResult.reason) };
	}

	// Process deal fields
	let dealFields: any = null;
	if (fieldsResult.status === 'fulfilled') {
		const raw = fieldsResult.value;
		const fields = (raw.fields || raw.data || []) as any[];
		const allFields = fields.map((f: any) => {
			const apiName = String(f?.api_name || '');
			const dataType = String(f?.data_type || '');
			let lookupModule = '';
			if (f?.lookup?.module?.api_name) lookupModule = String(f.lookup.module.api_name);
			else if (f?.multiselectlookup?.connected_module?.api_name)
				lookupModule = String(f.multiselectlookup.connected_module.api_name);
			return { api_name: apiName, data_type: dataType, lookup_module: lookupModule || undefined };
		});
		const tradeRelated = allFields.filter((f: any) =>
			/trade|partner|vendor|subcontract|portal/i.test(f.api_name)
		);
		const lookupFields = allFields.filter(
			(f: any) => f.data_type === 'lookup' || f.data_type === 'multiselectlookup' || f.lookup_module
		);
		const portalTP = fields.find((f: any) => String(f?.api_name || '') === 'Portal_Trade_Partners');
		dealFields = {
			total: allFields.length,
			allFields,
			tradeRelated,
			lookupFields,
			portalTradePartnersField: portalTP
				? {
						api_name: portalTP.api_name,
						data_type: portalTP.data_type,
						field_label: portalTP.field_label,
						lookup: portalTP.lookup,
						multiselectlookup: portalTP.multiselectlookup,
						json_type: portalTP.json_type
					}
				: null
		};
	} else {
		errors.push(`Fields API error: ${fieldsResult.reason}`);
		dealFields = { error: String(fieldsResult.reason) };
	}

	// Process sample deals
	let sampleDeals: any = null;
	if (dealsResult.status === 'fulfilled') {
		const raw = dealsResult.value;
		const deals = (raw.data || []) as any[];
		sampleDeals = {
			count: deals.length,
			deals: deals.map((d: any) => {
				const keys = Object.keys(d);
				return { id: d.id, Deal_Name: d.Deal_Name, Stage: d.Stage, allKeys: keys, raw: d };
			})
		};
	} else {
		errors.push(`Deals API error: ${dealsResult.reason}`);
		sampleDeals = { error: String(dealsResult.reason) };
	}

	// Process Supabase trade partners
	let tradePartners: any = null;
	if (tradePartnersResult.status === 'fulfilled') {
		const { data, error } = tradePartnersResult.value;
		if (error) {
			errors.push(`Supabase trade_partners error: ${error.message}`);
			tradePartners = { error: error.message };
		} else {
			tradePartners = { count: (data || []).length, records: data || [] };
		}
	} else {
		errors.push(`Supabase error: ${tradePartnersResult.reason}`);
		tradePartners = { error: String(tradePartnersResult.reason) };
	}

	// Optional: look up a specific trade partner's Zoho record
	const zohoId = url.searchParams.get('zohoId');
	let specificTradePartner: any = null;
	if (zohoId) {
		const modulesToTry = modules?.tradeRelated?.length
			? modules.tradeRelated
			: ['Trade_Partners', 'Vendors', 'Contacts'];
		for (const mod of modulesToTry) {
			try {
				const result = await zohoApiCall(
					accessToken,
					`/${encodeURIComponent(mod)}/${encodeURIComponent(zohoId)}`,
					{},
					apiDomain
				);
				const record = result?.data?.[0] || result;
				if (record && typeof record === 'object') {
					specificTradePartner = {
						module: mod,
						record,
						keys: Object.keys(record)
					};
					break;
				}
			} catch {
				// try next module
			}
		}
		if (!specificTradePartner) {
			specificTradePartner = { error: `Record ${zohoId} not found in modules: ${modulesToTry.join(', ')}` };
		}
	}

	return json({
		timestamp: new Date().toISOString(),
		errors: errors.length > 0 ? errors : undefined,
		modules,
		dealFields,
		sampleDeals,
		tradePartners,
		specificTradePartner: specificTradePartner || undefined
	});
};
