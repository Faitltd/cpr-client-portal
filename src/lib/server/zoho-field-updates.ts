import { env } from '$env/dynamic/private';
import { createTranscodingJob, supabase } from '$lib/server/db';
import { getZohoApiBase, zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';

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

export async function getAccessTokenAndDomain(): Promise<{
	accessToken: string;
	apiDomain?: string;
}> {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw new Error('Zoho tokens not configured');
	}

	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
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

export interface ZohoAttachmentTarget {
	moduleApiName: string;
	recordId: string;
}

export async function uploadAttachmentsToZoho(
	accessToken: string,
	targets: ZohoAttachmentTarget | ZohoAttachmentTarget[],
	photoIds: string[],
	apiDomain?: string
): Promise<void> {
	const base = getZohoApiBase(apiDomain);
	const targetList = Array.isArray(targets) ? targets : [targets];
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

			for (const target of targetList) {
				const form = new FormData();
				form.append('file', new Blob([arrayBuffer], { type: mimeType }), fileName);

				const url = `${base}/${encodeURIComponent(target.moduleApiName)}/${encodeURIComponent(target.recordId)}/Attachments`;
				const res = await fetch(url, {
					method: 'POST',
					headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
					body: form,
					signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
				});

				if (!res.ok) {
					const text = await res.text().catch(() => '');
					console.warn(
						`[field-updates] Zoho attachment upload failed for ${storagePath} → ${target.moduleApiName}/${target.recordId}: ${res.status} ${text}`
					);
				} else {
					console.info(
						`[field-updates] Uploaded attachment to Zoho ${target.moduleApiName}/${target.recordId}: ${storagePath}`
					);
				}
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
			// Attach each photo to BOTH the Field Update record and the parent Deal
			// so all field photos live on the Deal's attachments too.
			uploadAttachmentsToZoho(
				accessToken,
				[
					{ moduleApiName: ZOHO_FIELD_UPDATES_MODULE, recordId: zohoRecordId },
					{ moduleApiName: 'Deals', recordId: dealId }
				],
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

// Change-order review task: owner + who to mention. Overridable via env; the
// defaults are the current Zoho user id for Mary Sue and Jeff's contact.
const CO_TASK_OWNER_ID = env.CO_REVIEW_TASK_OWNER_ID || '6162061000000865001'; // Mary Sue Mugge
const CO_TASK_MENTION = env.CO_REVIEW_TASK_MENTION || 'Jeff Smither (jeff@homecpr.pro)';

/**
 * Create a Zoho CRM Task to review a change order, assigned to Mary Sue and
 * mentioning Jeff, linked to the Deal. Best-effort — returns a diag object.
 */
export async function createChangeOrderReviewTask(opts: {
	accessToken: string;
	apiDomain?: string;
	dealId: string;
	dealName: string | null;
	note: string | null;
	submitterName: string | null;
}): Promise<{ ok: boolean; taskId?: string; error?: string }> {
	try {
		const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
		const project = opts.dealName?.trim() || `Deal ${opts.dealId.slice(-6)}`;
		const description = [
			opts.note?.trim() || 'Change order submitted via the portal.',
			'',
			`Please review with ${CO_TASK_MENTION}.`,
			opts.submitterName ? `Submitted by ${opts.submitterName}.` : ''
		]
			.filter(Boolean)
			.join('\n');

		const record: Record<string, unknown> = {
			Subject: `Review Change Order — ${project}`,
			Status: 'Not Started',
			Priority: 'High',
			Due_Date: due,
			Description: description,
			$se_module: 'Deals',
			What_Id: opts.dealId
		};
		if (CO_TASK_OWNER_ID) record.Owner = { id: CO_TASK_OWNER_ID };

		const res = await zohoApiCall(
			opts.accessToken,
			'/Tasks',
			{
				method: 'POST',
				body: JSON.stringify({ data: [record] }),
				signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
			},
			opts.apiDomain
		);
		const first = res?.data?.[0];
		if (first?.code === 'SUCCESS' || first?.status === 'success') {
			return { ok: true, taskId: first?.details?.id };
		}
		return { ok: false, error: first?.message || first?.code || 'Task create failed' };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

export interface FieldUpdateListItem {
	id: string;
	name: string | null;
	type: string | null;
	note: string | null;
	created: string | null;
	dealId: string | null;
	dealName: string | null;
}

/**
 * Fetch recent field updates across ALL deals (admin oversight view). Uses the
 * admin Zoho token, newest first.
 */
export async function getAllFieldUpdates(limit = 150): Promise<FieldUpdateListItem[]> {
	const { accessToken, apiDomain } = await getAccessTokenAndDomain();
	const dealField =
		ZOHO_FIELD_UPDATES_DEAL_FIELD || (await discoverDealLookupField(accessToken, apiDomain));
	const fieldList = ['Name', 'Note', 'Update_Type', 'Created_Time', dealField]
		.filter(Boolean)
		.join(',');

	const perPage = Math.min(Math.max(limit, 1), 200);
	const response = await zohoApiCall(
		accessToken,
		`/${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}?fields=${encodeURIComponent(
			fieldList
		)}&sort_by=Created_Time&sort_order=desc&per_page=${perPage}`,
		{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
		apiDomain
	);

	const rows = Array.isArray(response?.data) ? response.data : [];
	return rows.map((r: any): FieldUpdateListItem => {
		const dealLookup = dealField ? r[dealField] : null;
		return {
			id: String(r.id ?? ''),
			name: typeof r.Name === 'string' ? r.Name : null,
			type: typeof r.Update_Type === 'string' ? r.Update_Type : null,
			note: typeof r.Note === 'string' ? r.Note : null,
			created: typeof r.Created_Time === 'string' ? r.Created_Time : null,
			dealId: dealLookup?.id ? String(dealLookup.id) : null,
			dealName: dealLookup?.name ?? null
		};
	});
}
