import { env } from '$env/dynamic/private';
import {
	createTranscodingJob,
	getZohoTokens,
	supabase,
	upsertZohoTokens
} from '$lib/server/db';
import { getZohoApiBase, refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

export const ZOHO_FIELD_UPDATES_MODULE = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
/** Explicit override — set this in your env to skip auto-discovery entirely */
export const ZOHO_FIELD_UPDATES_DEAL_FIELD = env.ZOHO_FIELD_UPDATES_DEAL_FIELD || '';
export const ZOHO_TIMEOUT_MS = 15_000;

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv', 'hevc']);
export function isVideoPath(storagePath: string) {
	const ext = storagePath.split('.').pop()?.toLowerCase() || '';
	return VIDEO_EXTS.has(ext);
}

/** Map internal update_type values to Zoho-friendly display labels */
export const UPDATE_TYPE_LABELS: Record<string, string> = {
	progress: 'Site Visit/Progress Update',
	issue: 'Issue',
	material_delivery: 'Material Delivery',
	inspection: 'Inspection',
	weather_delay: 'Weather Delay',
	schedule_change: 'Schedule Change',
	completed_work: 'Completed Work',
	change_order: 'Change Order Request',
	other: 'Other'
};

export const VALID_UPDATE_TYPES = new Set(Object.keys(UPDATE_TYPE_LABELS));

export function pickSubmitterDisplayName(submitter: {
	name?: string | null;
	company?: string | null;
	email?: string | null;
}) {
	return (
		String(submitter?.name || '').trim() ||
		String(submitter?.company || '').trim() ||
		String(submitter?.email || '').trim() ||
		'Submitter'
	);
}

export function buildZohoFieldUpdateNote(note: string | null, submitterName: string) {
	const trimmed = String(note || '').trim();
	const prefix = `Submitted by: ${submitterName}`;
	if (!trimmed) return prefix;
	if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed;
	return `${prefix}\n\n${trimmed}`;
}

export function buildZohoFieldUpdateName(label: string, submitterName: string, now = new Date()) {
	return `${label} — ${submitterName} — ${now.toLocaleDateString()}`;
}

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

export async function getAccessTokenAndDomain(): Promise<{
	accessToken: string;
	apiDomain?: string;
}> {
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

let cachedDealField: string | null = null;
let cachedDealFieldAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function discoverDealLookupField(
	accessToken: string,
	apiDomain?: string
): Promise<string | null> {
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
			console.error(
				'Zoho settings/fields call failed:',
				response.status,
				await response.text().catch(() => '')
			);
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

			if (dataType.includes('lookup') && lookupModuleName.includes('deals')) {
				cachedDealField = apiName;
				cachedDealFieldAt = Date.now();
				console.info(
					`Discovered deal lookup field for ${ZOHO_FIELD_UPDATES_MODULE}: ${apiName}`
				);
				return apiName;
			}

			if (dataType.includes('lookup') && label.includes('deal')) {
				cachedDealField = apiName;
				cachedDealFieldAt = Date.now();
				console.info(
					`Discovered deal lookup field (label match) for ${ZOHO_FIELD_UPDATES_MODULE}: ${apiName}`
				);
				return apiName;
			}
		}
	} catch (err) {
		console.error('Failed to discover deal lookup field:', err);
	}

	return null;
}

const ZOHO_ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024;
const FILE_MIME_MAP: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	avi: 'video/x-msvideo',
	webm: 'video/webm',
	mkv: 'video/x-matroska',
	wmv: 'video/x-ms-wmv'
};

export async function uploadAttachmentsToZoho(
	accessToken: string,
	moduleApiName: string,
	recordId: string,
	photoIds: string[],
	apiDomain?: string
): Promise<void> {
	const base = getZohoApiBase(apiDomain);
	for (const storagePath of photoIds) {
		try {
			const { data, error } = await supabase.storage.from('trade-photos').download(storagePath);
			if (error || !data) {
				console.warn(
					`[field-updates] Could not download ${storagePath} from Supabase:`,
					error?.message
				);
				continue;
			}

			const arrayBuffer = await data.arrayBuffer();
			if (arrayBuffer.byteLength > ZOHO_ATTACHMENT_SIZE_LIMIT) {
				console.info(
					`[field-updates] Skipping immediate Zoho upload for ${storagePath} — ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds 20MB limit; transcoding worker will attach a compressed version`
				);
				continue;
			}

			const fileName = storagePath.split('/').pop() || 'attachment';
			const ext = fileName.split('.').pop()?.toLowerCase() || '';
			const mimeType = FILE_MIME_MAP[ext] || 'application/octet-stream';

			const form = new FormData();
			form.append('file', new Blob([arrayBuffer], { type: mimeType }), fileName);

			const url = `${base}/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}/Attachments`;
			const res = await fetch(url, {
				method: 'POST',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
				body: form,
				signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				console.warn(
					`[field-updates] Zoho attachment upload failed for ${storagePath}: ${res.status} ${text}`
				);
			} else {
				console.info(`[field-updates] Uploaded attachment to Zoho: ${storagePath}`);
			}
		} catch (err) {
			console.warn(`[field-updates] Attachment upload error for ${storagePath}:`, err);
		}
	}
}

export interface CreateFieldUpdateOptions {
	accessToken: string;
	apiDomain?: string;
	dealId: string;
	updateType: string;
	note: string | null;
	submitter: { name?: string | null; company?: string | null; email?: string | null };
	photoIds?: string[] | null;
}

export interface CreateFieldUpdateResult {
	zohoRecordId: string | null;
	dealField: string | null;
}

/**
 * Create a Zoho CRM Field_Updates record (which triggers the Cliq workflow),
 * then queue media attachments. Caller is responsible for any Supabase backup
 * writes since those vary per submitter type (trade partner vs client).
 */
export async function createCrmFieldUpdate(
	opts: CreateFieldUpdateOptions
): Promise<CreateFieldUpdateResult> {
	const { accessToken, apiDomain, dealId, updateType, note, submitter, photoIds } = opts;

	const dealField =
		ZOHO_FIELD_UPDATES_DEAL_FIELD || (await discoverDealLookupField(accessToken, apiDomain));
	if (!dealField) {
		throw new Error(
			`Could not discover deal lookup field on ${ZOHO_FIELD_UPDATES_MODULE}. Set ZOHO_FIELD_UPDATES_DEAL_FIELD env var.`
		);
	}

	const submitterName = pickSubmitterDisplayName(submitter);
	const label = UPDATE_TYPE_LABELS[updateType] || updateType;
	const zohoRecord: Record<string, unknown> = {
		Note: buildZohoFieldUpdateNote(note, submitterName),
		Update_Type: label,
		Name: buildZohoFieldUpdateName(label, submitterName),
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
		throw new Error(`Failed to save field update: ${errDetail}`);
	}

	const zohoRecordId: string | null = firstResult?.details?.id || null;

	if (Array.isArray(photoIds) && photoIds.length > 0 && zohoRecordId) {
		const photos = photoIds.filter((p: string) => !isVideoPath(p));
		const videos = photoIds.filter((p: string) => isVideoPath(p));

		if (photos.length > 0) {
			uploadAttachmentsToZoho(
				accessToken,
				ZOHO_FIELD_UPDATES_MODULE,
				zohoRecordId,
				photos,
				apiDomain
			).catch((err) => console.error('[field-updates] Attachment upload error:', err));
		}

		for (const videoPath of videos) {
			createTranscodingJob({
				original_path: videoPath,
				zoho_record_id: zohoRecordId ?? undefined,
				zoho_module: ZOHO_FIELD_UPDATES_MODULE
			}).catch((err) =>
				console.warn(
					'[field-updates] Could not queue transcoding job (worker may not be set up yet):',
					err
				)
			);
		}
	}

	return { zohoRecordId, dealField };
}
