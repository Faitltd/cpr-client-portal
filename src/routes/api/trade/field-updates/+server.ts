import { json } from '@sveltejs/kit';
import { createFieldUpdate, getTradeSession, supabase } from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { zohoApiCall } from '$lib/server/zoho';
import {
	extractWorkDriveFolderId,
	resolveOrCreateClientPhotosFolder,
	uploadFileToWorkDriveFolder
} from '$lib/server/workdrive';
import {
	VALID_UPDATE_TYPES,
	createCrmFieldUpdate,
	getAccessTokenAndDomain,
	pickSubmitterDisplayName
} from '$lib/server/zoho-field-updates';
import { buildCrmRecordUrl, parseCliqChannelUrl, postFieldUpdateNotification } from '$lib/server/cliq-notifications';
import { ZOHO_FIELD_UPDATES_MODULE } from '$lib/server/zoho-field-updates';
import type { RequestHandler } from './$types';

const STORAGE_BUCKET = 'trade-photos';

function guessImageContentType(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	switch (ext) {
		case 'png':
			return 'image/png';
		case 'webp':
			return 'image/webp';
		case 'gif':
			return 'image/gif';
		case 'heic':
		case 'heif':
			return 'image/heic';
		default:
			return 'image/jpeg';
	}
}

/**
 * Mirror the curated client photos into the deal's WorkDrive
 * "Client Portal/Photos" folder (a duplicate; the Supabase copy stays for fast
 * portal serving). Best-effort — never blocks or fails the field-update save.
 */
async function archiveClientPhotosToWorkDrive(opts: {
	accessToken: string;
	apiDomain?: string;
	dealId: string;
	clientPhotoIds: string[];
}): Promise<{ uploaded: number; error?: string }> {
	const { accessToken, apiDomain, dealId, clientPhotoIds } = opts;
	if (clientPhotoIds.length === 0) return { uploaded: 0 };
	try {
		const dealRes = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=WorkDrive_Folder_ID`,
			{},
			apiDomain
		);
		const rec = dealRes?.data?.[0] ?? {};
		const rawId =
			typeof rec.WorkDrive_Folder_ID === 'string' ? rec.WorkDrive_Folder_ID.trim() : '';
		const rootId = extractWorkDriveFolderId(rawId) || rawId || null;
		if (!rootId) return { uploaded: 0, error: 'no WorkDrive folder on deal' };

		const photosFolderId = await resolveOrCreateClientPhotosFolder(accessToken, rootId, apiDomain);
		if (!photosFolderId) return { uploaded: 0, error: 'could not resolve Photos folder' };

		let uploaded = 0;
		for (const path of clientPhotoIds) {
			try {
				const { data: blob, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
				if (error || !blob) {
					console.warn('[field-updates] storage download failed:', path, error?.message);
					continue;
				}
				const bytes = new Uint8Array(await blob.arrayBuffer());
				const fileName = path.split('/').pop() || `photo-${Date.now()}.jpg`;
				const id = await uploadFileToWorkDriveFolder(
					accessToken,
					photosFolderId,
					fileName,
					bytes,
					guessImageContentType(path),
					apiDomain
				);
				if (id) uploaded += 1;
			} catch (e) {
				console.warn(
					'[field-updates] WorkDrive archive item failed:',
					path,
					e instanceof Error ? e.message : e
				);
			}
		}
		return { uploaded };
	} catch (e) {
		return { uploaded: 0, error: e instanceof Error ? e.message : 'archive failed' };
	}
}

async function isDealAuthorizedForTradePartner(
	accessToken: string,
	dealId: string,
	zohoTradePartnerId: string
) {
	const dealList = await getTradePartnerDeals(accessToken, zohoTradePartnerId);
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

async function fetchDealMeta(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<{ dealName: string | null; cliqChannel: string | null }> {
	try {
		const response = await zohoApiCall(
			accessToken,
			`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,Cliq_Internal_Channel_ID,Cliq_Channel`,
			{},
			apiDomain
		);
		const record = response?.data?.[0] ?? {};
		const name = typeof record.Deal_Name === 'string' ? record.Deal_Name.trim() : '';
		// Prefer Cliq_Internal_Channel_ID (Guikema URL format, populated by the
		// Lead-Qualified function in CRM). Fall back to legacy Cliq_Channel
		// field (raw channel name, populated by the older WD-Folder function).
		const internalUrl =
			typeof record.Cliq_Internal_Channel_ID === 'string'
				? record.Cliq_Internal_Channel_ID.trim()
				: '';
		const legacyChannel =
			typeof record.Cliq_Channel === 'string' ? record.Cliq_Channel.trim() : '';
		const channel = parseCliqChannelUrl(internalUrl) ?? legacyChannel;
		return {
			dealName: name || null,
			cliqChannel: channel || null
		};
	} catch (err) {
		console.warn('[trade/field-updates] Failed to fetch deal meta:', err);
		return { dealName: null, cliqChannel: null };
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
		const clientPhotoIds = body?.client_photo_ids;

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
		if (
			clientPhotoIds !== undefined &&
			clientPhotoIds !== null &&
			(!Array.isArray(clientPhotoIds) ||
				!clientPhotoIds.every((item: unknown) => typeof item === 'string'))
		) {
			return json(
				{ error: 'Invalid client_photo_ids. Must be an array of strings' },
				{ status: 400 }
			);
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
				photo_ids: Array.isArray(photoIds) ? photoIds : null,
				client_photo_ids: Array.isArray(clientPhotoIds) ? clientPhotoIds : null
			});
		} catch (supaErr) {
			console.error('Supabase backup write failed (Zoho record saved):', supaErr);
		}

		// Cliq daily-log card includes BOTH the crew/internal photos and the
		// curated client photos (the client set must still appear in the log).
		const allPhotoIds = Array.from(
			new Set([
				...(Array.isArray(photoIds) ? photoIds : []),
				...(Array.isArray(clientPhotoIds) ? clientPhotoIds : [])
			])
		);

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
			const { dealName, cliqChannel } = await fetchDealMeta(accessToken, apiDomain, dealId);
			const cliqResult = await postFieldUpdateNotification({
				accessToken,
				updateType,
				dealName,
				dealId,
				submitterName: pickSubmitterDisplayName(session.trade_partner),
				submitterEmail: session.trade_partner?.email ?? null,
				submitterRole: 'trade',
				note,
				photoIds: allPhotoIds.length > 0 ? allPhotoIds : null,
				dealChannelName: cliqChannel,
				crmRecordUrl: buildCrmRecordUrl(ZOHO_FIELD_UPDATES_MODULE, zohoRecordId)
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

		// Duplicate the curated client photos into WorkDrive Client Portal/Photos.
		// Best-effort: the field update is already saved; archive failures only
		// surface as a diag field.
		let archiveDiag: { uploaded: number; error?: string } = { uploaded: 0 };
		if (Array.isArray(clientPhotoIds) && clientPhotoIds.length > 0) {
			archiveDiag = await archiveClientPhotosToWorkDrive({
				accessToken,
				apiDomain,
				dealId,
				clientPhotoIds
			});
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
					cliq: cliqDiag,
					workdrive_archive: archiveDiag
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
