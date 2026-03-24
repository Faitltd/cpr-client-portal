import { json } from '@sveltejs/kit';
import {
	createFieldUpdate,
	getTradeSession,
	getZohoTokens,
	supabase,
	upsertZohoTokens
} from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// ---------------------------------------------------------------------------
// Module / field configuration
// ---------------------------------------------------------------------------

const ZOHO_FIELD_UPDATES_MODULE = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
const ZOHO_TIMEOUT_MS = 15_000;

/** Map internal update_type values to Zoho-friendly display labels */
const UPDATE_TYPE_LABELS: Record<string, string> = {
	progress: 'Site Visit/Progress Update',
	issue: 'Issue',
	material_delivery: 'Material Delivery',
	inspection: 'Inspection',
	weather_delay: 'Weather Delay',
	schedule_change: 'Schedule Change',
	completed_work: 'Completed Work',
	other: 'Other'
};

const VALID_UPDATE_TYPES = new Set(Object.keys(UPDATE_TYPE_LABELS));

// ---------------------------------------------------------------------------
// Zoho access-token helper
// ---------------------------------------------------------------------------

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) {
		return date.toISOString();
	}
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.toISOString();
		}
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

async function getAccessTokenAndDomain(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw new Error('Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
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

	return { accessToken, apiDomain: tokens.api_domain || undefined };
}

// ---------------------------------------------------------------------------
// Auto-discover the deal-lookup field on the Field_Updates module (cached)
// ---------------------------------------------------------------------------

let cachedDealField: string | null = null;
let cachedDealFieldAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

async function discoverDealLookupField(
	accessToken: string,
	apiDomain?: string
): Promise<string | null> {
	// Return cached value if fresh
	if (cachedDealField && Date.now() - cachedDealFieldAt < CACHE_TTL_MS) {
		return cachedDealField;
	}

	try {
		const base = apiDomain
			? `${apiDomain.replace(/\/$/, '')}/crm/v2`
			: 'https://www.zohoapis.com/crm/v2';
		const url = `${base}/settings/fields?module=${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}`;
		const response = await fetch(url, {
			method: 'GET',
			signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS),
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			console.error('Zoho settings/fields call failed:', response.status, await response.text().catch(() => ''));
			return null;
		}

		const body = await response.json();
		const fields = (body.fields || body.data || []) as any[];

		for (const field of fields) {
			const apiName = String(field?.api_name || field?.apiName || '').trim();
			if (!apiName) continue;

			const dataType = String(field?.data_type || field?.dataType || field?.json_type || '')
				.toLowerCase()
				.trim();
			const label = String(field?.field_label || field?.display_label || field?.fieldLabel || '')
				.toLowerCase()
				.trim();

			const lookup = field?.lookup || field?.lookup_details || field?.lookupDetails || null;
			const lookupModule =
				lookup?.module?.api_name ||
				lookup?.module?.apiName ||
				lookup?.module ||
				lookup?.module_name ||
				lookup?.moduleName ||
				lookup?.module_api_name ||
				lookup?.moduleApiName ||
				null;
			const lookupModuleName = String(lookupModule || '').toLowerCase();

			// A lookup field that points to the Deals module
			if (dataType.includes('lookup') && lookupModuleName.includes('deals')) {
				cachedDealField = apiName;
				cachedDealFieldAt = Date.now();
				console.info(`Discovered deal lookup field for ${ZOHO_FIELD_UPDATES_MODULE}: ${apiName}`);
				return apiName;
			}

			// Fallback: a lookup whose label contains "deal"
			if (dataType.includes('lookup') && label.includes('deal')) {
				cachedDealField = apiName;
				cachedDealFieldAt = Date.now();
				console.info(`Discovered deal lookup field (label match) for ${ZOHO_FIELD_UPDATES_MODULE}: ${apiName}`);
				return apiName;
			}
		}
	} catch (err) {
		console.error('Failed to discover deal lookup field:', err);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Authorization check
// ---------------------------------------------------------------------------

async function isDealAuthorizedForTradePartner(accessToken: string, dealId: string) {
	const dealList = await getTradePartnerDeals(accessToken);
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const session = await getTradeSession(token);
		if (!session || new Date(session.expires_at) < new Date()) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json().catch(() => ({}));
		const dealId = String(body?.deal_id || '').trim();
		const updateType = String(body?.update_type || '').trim();
		const note = typeof body?.note === 'string' ? body.note.trim() : null;
		const photoIds = body?.photo_ids;

		if (!dealId) {
			return json({ error: 'Missing required field: deal_id' }, { status: 400 });
		}
		if (!updateType) {
			return json({ error: 'Missing required field: update_type' }, { status: 400 });
		}
		if (!VALID_UPDATE_TYPES.has(updateType)) {
			return json(
				{
					error:
						'Invalid update_type. Must be one of: progress, issue, material_delivery, inspection, weather_delay, schedule_change, completed_work, other'
				},
				{ status: 400 }
			);
		}
		if (
			photoIds !== undefined &&
			photoIds !== null &&
			(!Array.isArray(photoIds) || !photoIds.every((item: unknown) => typeof item === 'string'))
		) {
			return json({ error: 'Invalid photo_ids. Must be an array of strings' }, { status: 400 });
		}

		if (!session.trade_partner?.zoho_trade_partner_id) {
			return json({ error: 'Trade partner is missing Zoho ID' }, { status: 400 });
		}

		// Get a fresh Zoho access token
		const { accessToken, apiDomain } = await getAccessTokenAndDomain();

		const authorized = await isDealAuthorizedForTradePartner(accessToken, dealId);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this trade partner' }, { status: 403 });
		}

		// ── 1. Write to Zoho CRM (primary — triggers Cliq workflow) ──────────
		const dealField = await discoverDealLookupField(accessToken, apiDomain);
		if (!dealField) {
			console.error(`Could not discover deal lookup field on ${ZOHO_FIELD_UPDATES_MODULE}`);
			return json(
				{ error: 'Unable to save: field update module configuration issue. Please contact the office.' },
				{ status: 502 }
			);
		}

		const zohoRecord: Record<string, unknown> = {
			Note: note || '',
			Update_Type: UPDATE_TYPE_LABELS[updateType] || updateType,
			Name: `${UPDATE_TYPE_LABELS[updateType] || updateType} — ${new Date().toLocaleDateString()}`,
			[dealField]: { id: dealId }
		};

		const zohoResponse = await zohoApiCall(
			accessToken,
			`/${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}`,
			{
				method: 'POST',
				body: JSON.stringify({ data: [zohoRecord] }),
				signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
			},
			apiDomain
		);

		const firstResult = zohoResponse?.data?.[0];
		if (firstResult?.code !== 'SUCCESS' && firstResult?.status !== 'success') {
			const errDetail = firstResult?.message || firstResult?.code || 'Unknown Zoho error';
			console.error('Zoho Field_Updates create failed:', JSON.stringify(firstResult));
			return json(
				{ error: `Failed to save field update: ${errDetail}` },
				{ status: 502 }
			);
		}

		const zohoRecordId = firstResult?.details?.id || null;

		// ── 2. Write to Supabase (backup / local record) ─────────────────────
		let created: any = null;
		try {
			created = await createFieldUpdate({
				deal_id: dealId,
				trade_partner_id: session.trade_partner_id,
				update_type: updateType,
				note: note || null,
				photo_ids: photoIds ?? null
			});
		} catch (supaErr) {
			// Non-fatal: the Zoho record (the important one) was already created
			console.error('Supabase backup write failed (Zoho record saved):', supaErr);
		}

		let photo_urls: string[] | null = null;
		if (created?.photo_ids?.length) {
			photo_urls = created.photo_ids.map(
				(id: string) => supabase.storage.from('trade-photos').getPublicUrl(id).data.publicUrl
			);
		}

		return json(
			{ data: { ...(created || {}), photo_urls, zoho_record_id: zohoRecordId } },
			{ status: 201 }
		);
	} catch (err) {
		console.error('Failed to create field update:', err);
		const message = err instanceof Error ? err.message : 'Failed to create field update';
		return json({ error: message }, { status: 500 });
	}
};
