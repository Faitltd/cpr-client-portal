/**
 * ONE-TIME admin endpoint to sync field updates from Supabase → Zoho CRM.
 *
 * GET  /api/admin/sync-field-updates          — preview (dry run)
 * POST /api/admin/sync-field-updates          — execute sync
 *
 * Remove this file after the backfill is done.
 */

import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens, supabase } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_FIELD_UPDATES_MODULE = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
const ZOHO_TIMEOUT_MS = 15_000;

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

function pickSubmitterDisplayName(partner: {
	name?: string | null;
	company?: string | null;
	email?: string | null;
} | null | undefined) {
	return (
		String(partner?.name || '').trim() ||
		String(partner?.company || '').trim() ||
		String(partner?.email || '').trim() ||
		'Trade Partner'
	);
}

function buildZohoFieldUpdateNote(note: string | null, submitterName: string) {
	const trimmed = String(note || '').trim();
	const prefix = `Submitted by: ${submitterName}`;
	if (!trimmed) return prefix;
	if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed;
	return `${prefix}\n\n${trimmed}`;
}

function buildZohoFieldUpdateName(label: string, submitterName: string, createdAt?: string | null) {
	const date = createdAt ? new Date(createdAt) : new Date();
	const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
	return `${label} — ${submitterName} — ${safeDate.toLocaleDateString()}`;
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fb = new Date(fallback as any);
		if (!Number.isNaN(fb.getTime())) return fb.toISOString();
	}
	return new Date().toISOString();
}

async function getAccessTokenAndDomain() {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho tokens not configured');

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

async function discoverDealLookupField(accessToken: string, apiDomain?: string): Promise<string | null> {
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

	if (!response.ok) return null;

	const body = await response.json();
	const fields = (body.fields || body.data || []) as any[];

	for (const field of fields) {
		const apiName = String(field?.api_name || '').trim();
		if (!apiName) continue;
		const dataType = String(field?.data_type || '').toLowerCase().trim();
		const label = String(field?.field_label || '').toLowerCase().trim();
		const lookupModule = String(
			field?.lookup?.module?.api_name ||
			field?.lookup?.module ||
			field?.lookup?.module_name ||
			''
		).toLowerCase();

		if (dataType.includes('lookup') && (lookupModule.includes('deals') || label.includes('deal'))) {
			return apiName;
		}
	}

	return null;
}

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

// GET = dry run / preview
export const GET: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { data: rows, error } = await supabase
			.from('field_updates')
			.select('*')
			.order('created_at', { ascending: true });

		if (error) throw new Error(error.message);

		const { accessToken, apiDomain } = await getAccessTokenAndDomain();
		const dealField = await discoverDealLookupField(accessToken, apiDomain);

		return json({
			mode: 'dry_run',
			total_in_supabase: (rows || []).length,
			deal_lookup_field: dealField,
			module: ZOHO_FIELD_UPDATES_MODULE,
			records: (rows || []).map((r: any) => ({
				id: r.id,
				deal_id: r.deal_id,
				update_type: r.update_type,
				note: r.note?.slice(0, 100) || null,
				created_at: r.created_at
			}))
		});
	} catch (err) {
		console.error('Sync preview failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};

// POST = execute sync
export const POST: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { data: rows, error } = await supabase
			.from('field_updates')
			.select('*')
			.order('created_at', { ascending: true });

		if (error) throw new Error(error.message);
		if (!rows || rows.length === 0) {
			return json({ synced: 0, failed: 0, message: 'No records to sync' });
		}

		const tradePartnerIds = Array.from(
			new Set(
				rows
					.map((row: any) => String(row?.trade_partner_id || '').trim())
					.filter(Boolean)
			)
		);
		const tradePartnerMap = new Map<string, { name?: string | null; company?: string | null; email?: string | null }>();
		if (tradePartnerIds.length > 0) {
			const { data: partners, error: partnerError } = await supabase
				.from('trade_partners')
				.select('id, name, company, email')
				.in('id', tradePartnerIds);
			if (partnerError) throw new Error(`Trade partner lookup failed: ${partnerError.message}`);
			for (const partner of partners || []) {
				tradePartnerMap.set(String((partner as any).id), partner as any);
			}
		}

		const { accessToken, apiDomain } = await getAccessTokenAndDomain();
		const dealField = await discoverDealLookupField(accessToken, apiDomain);
		if (!dealField) {
			return json(
				{ error: `Could not discover deal lookup field on ${ZOHO_FIELD_UPDATES_MODULE}` },
				{ status: 502 }
			);
		}

		let synced = 0;
		let failed = 0;
		const results: any[] = [];

		for (const row of rows) {
			const label = UPDATE_TYPE_LABELS[row.update_type] || row.update_type || 'Other';
			const submitterName = pickSubmitterDisplayName(
				tradePartnerMap.get(String(row.trade_partner_id || '').trim())
			);

			const zohoRecord: Record<string, unknown> = {
				Note: buildZohoFieldUpdateNote(row.note || null, submitterName),
				Update_Type: label,
				Name: buildZohoFieldUpdateName(label, submitterName, row.created_at),
				[dealField]: { id: row.deal_id }
			};

			try {
				const response = await zohoApiCall(
					accessToken,
					`/${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}`,
					{
						method: 'POST',
						body: JSON.stringify({ data: [zohoRecord] }),
						signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
					},
					apiDomain
				);

				const first = response?.data?.[0];
				if (first?.code === 'SUCCESS' || first?.status === 'success') {
					synced++;
					results.push({
						supabase_id: row.id,
						deal_id: row.deal_id,
						zoho_id: first?.details?.id || null,
						status: 'synced'
					});
				} else {
					failed++;
					results.push({
						supabase_id: row.id,
						deal_id: row.deal_id,
						status: 'failed',
						error: first?.message || first?.code || 'Unknown'
					});
				}
			} catch (err) {
				failed++;
				results.push({
					supabase_id: row.id,
					deal_id: row.deal_id,
					status: 'failed',
					error: err instanceof Error ? err.message : 'Unknown error'
				});
			}

			// Small delay to avoid Zoho rate limits
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		return json({ synced, failed, total: rows.length, deal_field: dealField, results });
	} catch (err) {
		console.error('Sync execution failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
