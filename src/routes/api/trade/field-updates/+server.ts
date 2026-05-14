import { json } from '@sveltejs/kit';
import { createFieldUpdate, getTradeSession } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { zohoApiCall } from '$lib/server/zoho';
import {
	VALID_UPDATE_TYPES,
	createCrmFieldUpdate,
	getAccessTokenAndDomain,
	pickSubmitterDisplayName
} from '$lib/server/zoho-field-updates';
import { postFieldUpdateNotification } from '$lib/server/cliq-notifications';
import type { RequestHandler } from './$types';

async function isDealAuthorizedForTradePartner(
	accessToken: string,
	dealId: string,
	zohoTradePartnerId: string
) {
	const dealList = await getTradePartnerDeals(accessToken, zohoTradePartnerId);
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

async function fetchDealName(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<string | null> {
	try {
		const response = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name`,
			{},
			apiDomain
		);
		const name = response?.data?.[0]?.Deal_Name;
		return typeof name === 'string' && name.trim() ? name.trim() : null;
	} catch (err) {
		console.warn('[trade/field-updates] Failed to fetch deal name:', err);
		return null;
	}
}

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
						'Invalid update_type. Must be one of: progress, issue, material_delivery, inspection, weather_delay, schedule_change, completed_work, change_order, other'
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

		const { accessToken, apiDomain } = await getAccessTokenAndDomain();

		const authorized = await isDealAuthorizedForTradePartner(
			accessToken,
			dealId,
			session.trade_partner.zoho_trade_partner_id
		);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this trade partner' }, { status: 403 });
		}

		let zohoRecordId: string | null = null;
		try {
			const result = await createCrmFieldUpdate({
				accessToken,
				apiDomain,
				dealId,
				updateType,
				note,
				submitter: session.trade_partner,
				photoIds: Array.isArray(photoIds) ? photoIds : null
			});
			zohoRecordId = result.zohoRecordId;
		} catch (err) {
			console.error('createCrmFieldUpdate failed:', err);
			const message = err instanceof Error ? err.message : 'Failed to save field update';
			return json({ error: message }, { status: 502 });
		}

		let created: any = null;
		try {
			created = await createFieldUpdate({
				deal_id: dealId,
				trade_partner_id: session.trade_partner_id,
				update_type: updateType,
				note: note || null,
				photo_ids: Array.isArray(photoIds) ? photoIds : null
			});
		} catch (supaErr) {
			console.error('Supabase backup write failed (Zoho record saved):', supaErr);
		}

		// Direct Cliq post with inline images. Runs alongside the existing CRM
		// workflow's Cliq card; once the workflow is disabled on the Zoho side,
		// this becomes the sole Cliq notification path.
		let cliqDiag:
			| { ok: true; via: string }
			| { ok: false; via: string; status: number | null; error: string }
			| { ok: false; via: 'threw'; error: string } = {
			ok: false,
			via: 'unsent',
			status: null,
			error: 'not attempted'
		};
		try {
			const dealName = await fetchDealName(accessToken, apiDomain, dealId);
			const cliqResult = await postFieldUpdateNotification({
				accessToken,
				updateType,
				dealName,
				dealId,
				submitterName: pickSubmitterDisplayName(session.trade_partner),
				submitterEmail: session.trade_partner?.email ?? null,
				submitterRole: 'trade',
				note,
				photoIds: Array.isArray(photoIds) ? photoIds : null
			});
			if (cliqResult.ok) {
				cliqDiag = { ok: true, via: cliqResult.via };
			} else {
				cliqDiag = {
					ok: false,
					via: cliqResult.via,
					status: cliqResult.status ?? null,
					error: cliqResult.error
				};
				console.error(
					`[trade/field-updates] Cliq post failed (${cliqResult.via}):`,
					cliqResult.status,
					cliqResult.error
				);
			}
		} catch (cliqErr) {
			cliqDiag = {
				ok: false,
				via: 'threw',
				error: cliqErr instanceof Error ? cliqErr.message : String(cliqErr)
			};
			console.error('[trade/field-updates] Cliq notification threw:', cliqErr);
		}

		let photo_urls: string[] | null = null;
		if (created?.photo_ids?.length) {
			photo_urls = created.photo_ids.map((id: string) => `/api/trade/photos/storage/${id}`);
		}

		return json(
			{
				data: {
					...(created || {}),
					photo_urls,
					zoho_record_id: zohoRecordId,
					cliq: cliqDiag
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		console.error('Failed to create field update:', err);
		const message = err instanceof Error ? err.message : 'Failed to create field update';
		return json({ error: message }, { status: 500 });
	}
};
