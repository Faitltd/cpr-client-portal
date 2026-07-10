/**
 * ONE-TIME admin endpoint to copy photo attachments from Field_Updates
 * records to their linked Deal's attachments.
 *
 * GET  /api/admin/backfill-deal-photos          — preview (dry run)
 * POST /api/admin/backfill-deal-photos          — execute copy
 *
 * Optional query params:
 *   ?dealId=<zoho deal id>   — restrict to one deal
 *   ?limit=<n>               — cap number of field updates processed
 *
 * Remove this file after the backfill is done.
 */

import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoApiBase, zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ZOHO_FIELD_UPDATES_MODULE = env.ZOHO_FIELD_UPDATES_MODULE || 'Field_Updates';
const ZOHO_TIMEOUT_MS = 30_000;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif?f)$/i;

interface AttachmentInfo {
	id: string;
	fileName: string;
	size: number;
}

interface PlannedCopy {
	fieldUpdateId: string;
	fieldUpdateName: string | null;
	dealId: string;
	dealName: string | null;
	attachmentId: string;
	fileName: string;
	size: number;
}

async function getAccessTokenAndDomain() {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho tokens not configured');
	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
}

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

async function listAttachments(
	accessToken: string,
	apiDomain: string | undefined,
	moduleApiName: string,
	recordId: string
): Promise<AttachmentInfo[]> {
	const out: AttachmentInfo[] = [];
	let page = 1;
	for (;;) {
		const res = await zohoApiCall(
			accessToken,
			`/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}/Attachments?fields=id,File_Name,Size&per_page=200&page=${page}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		).catch(() => null);
		const rows = Array.isArray(res?.data) ? res.data : [];
		for (const r of rows) {
			out.push({
				id: String(r.id ?? ''),
				fileName: String(r.File_Name ?? ''),
				size: Number(r.Size ?? 0)
			});
		}
		if (!res?.info?.more_records) break;
		page += 1;
	}
	return out;
}

async function fetchAllFieldUpdates(
	accessToken: string,
	apiDomain: string | undefined,
	limit: number
): Promise<Array<{ id: string; name: string | null; dealId: string | null; dealName: string | null }>> {
	const out: Array<{ id: string; name: string | null; dealId: string | null; dealName: string | null }> = [];
	let pageToken: string | null = null;
	for (;;) {
		const tokenParam = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
		const res = await zohoApiCall(
			accessToken,
			`/${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}?fields=id,Name,Deal&sort_by=Created_Time&sort_order=asc&per_page=200${tokenParam}`,
			{ signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS) },
			apiDomain
		);
		const rows = Array.isArray(res?.data) ? res.data : [];
		for (const r of rows) {
			out.push({
				id: String(r.id ?? ''),
				name: typeof r.Name === 'string' ? r.Name : null,
				dealId: r.Deal?.id ? String(r.Deal.id) : null,
				dealName: r.Deal?.name ?? null
			});
			if (out.length >= limit) return out;
		}
		pageToken = res?.info?.more_records ? (res?.info?.next_page_token ?? null) : null;
		if (!pageToken) break;
	}
	return out;
}

/** Build the copy plan: image attachments on field updates missing from the Deal. */
async function buildPlan(
	accessToken: string,
	apiDomain: string | undefined,
	dealIdFilter: string | null,
	limit: number
): Promise<{ planned: PlannedCopy[]; scanned: number; skippedExisting: number }> {
	const updates = await fetchAllFieldUpdates(accessToken, apiDomain, limit);
	const dealAttachmentNames = new Map<string, Set<string>>();
	const planned: PlannedCopy[] = [];
	let scanned = 0;
	let skippedExisting = 0;

	for (const u of updates) {
		if (!u.dealId) continue;
		if (dealIdFilter && u.dealId !== dealIdFilter) continue;
		scanned += 1;

		const attachments = await listAttachments(
			accessToken,
			apiDomain,
			ZOHO_FIELD_UPDATES_MODULE,
			u.id
		);
		const images = attachments.filter((a) => IMAGE_EXT_RE.test(a.fileName));
		if (images.length === 0) continue;

		let existing = dealAttachmentNames.get(u.dealId);
		if (!existing) {
			const dealAttachments = await listAttachments(accessToken, apiDomain, 'Deals', u.dealId);
			existing = new Set(dealAttachments.map((a) => a.fileName));
			dealAttachmentNames.set(u.dealId, existing);
		}

		for (const img of images) {
			if (existing.has(img.fileName)) {
				skippedExisting += 1;
				continue;
			}
			existing.add(img.fileName); // avoid double-planning within this run
			planned.push({
				fieldUpdateId: u.id,
				fieldUpdateName: u.name,
				dealId: u.dealId,
				dealName: u.dealName,
				attachmentId: img.id,
				fileName: img.fileName,
				size: img.size
			});
		}
	}

	return { planned, scanned, skippedExisting };
}

function parseParams(url: URL): { dealIdFilter: string | null; limit: number } {
	const dealIdFilter = url.searchParams.get('dealId')?.trim() || null;
	const rawLimit = Number(url.searchParams.get('limit') ?? '10000');
	const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10000, 1), 10000);
	return { dealIdFilter, limit };
}

// GET = dry run / preview
export const GET: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { accessToken, apiDomain } = await getAccessTokenAndDomain();
		const { dealIdFilter, limit } = parseParams(url);
		const { planned, scanned, skippedExisting } = await buildPlan(
			accessToken,
			apiDomain,
			dealIdFilter,
			limit
		);
		return json({
			mode: 'dry_run',
			field_updates_scanned: scanned,
			photos_to_copy: planned.length,
			skipped_already_on_deal: skippedExisting,
			planned
		});
	} catch (err) {
		console.error('[backfill-deal-photos] preview failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};

// POST = execute copy
export const POST: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { accessToken, apiDomain } = await getAccessTokenAndDomain();
		const { dealIdFilter, limit } = parseParams(url);
		const { planned, scanned, skippedExisting } = await buildPlan(
			accessToken,
			apiDomain,
			dealIdFilter,
			limit
		);

		const base = getZohoApiBase(apiDomain);
		let copied = 0;
		let failed = 0;
		const results: any[] = [];

		for (const item of planned) {
			try {
				// Download the attachment bytes from the Field Update record.
				const downloadUrl = `${base}/${encodeURIComponent(ZOHO_FIELD_UPDATES_MODULE)}/${encodeURIComponent(item.fieldUpdateId)}/Attachments/${encodeURIComponent(item.attachmentId)}`;
				const dl = await fetch(downloadUrl, {
					headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
					signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
				});
				if (!dl.ok) {
					throw new Error(`Download failed: ${dl.status}`);
				}
				const bytes = await dl.arrayBuffer();

				// Upload to the Deal.
				const form = new FormData();
				form.append(
					'file',
					new Blob([bytes], { type: dl.headers.get('content-type') || 'application/octet-stream' }),
					item.fileName
				);
				const up = await fetch(
					`${base}/Deals/${encodeURIComponent(item.dealId)}/Attachments`,
					{
						method: 'POST',
						headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
						body: form,
						signal: AbortSignal.timeout(ZOHO_TIMEOUT_MS)
					}
				);
				if (!up.ok) {
					const text = await up.text().catch(() => '');
					throw new Error(`Upload failed: ${up.status} ${text.slice(0, 200)}`);
				}

				copied += 1;
				results.push({ ...item, status: 'copied' });
			} catch (err) {
				failed += 1;
				results.push({
					...item,
					status: 'failed',
					error: err instanceof Error ? err.message : 'Unknown error'
				});
			}

			// Small delay to avoid Zoho rate limits.
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		return json({
			field_updates_scanned: scanned,
			copied,
			failed,
			skipped_already_on_deal: skippedExisting,
			results
		});
	} catch (err) {
		console.error('[backfill-deal-photos] execution failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
