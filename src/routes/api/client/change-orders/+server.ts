import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	createChangeOrder,
	getChangeOrdersForDeal,
	getSession,
	supabase
} from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { zohoApiCall } from '$lib/server/zoho';
import {
	createCrmFieldUpdate,
	getAccessTokenAndDomain,
	isVideoPath
} from '$lib/server/zoho-field-updates';
import {
	attachFileToBooksEstimate,
	createBooksEstimateDraft,
	getBooksCustomerByEmail
} from '$lib/server/books';
import { postCliqChatMessage } from '$lib/server/cliq';
import type { RequestHandler } from './$types';

const CLIQ_CO_CHAT_ID = env.ZOHO_CLIQ_CO_CHAT_ID || 'O5797744000003118001';

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

const BOOKS_ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024; // Books accepts up to 10MB per attachment

function formatTimestampForReference(now = new Date()) {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

async function fetchDealName(accessToken: string, apiDomain: string | undefined, dealId: string) {
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
		console.warn('[client/change-orders] Failed to fetch deal name:', err);
		return null;
	}
}

async function authorizeClientForDeal(
	session: { client: { zoho_contact_id: string | null; email: string } },
	dealId: string
) {
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal: any) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const token = cookies.get('portal_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = await getSession(token);
	if (!session || new Date(session.expires_at) < new Date()) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const dealId = String(url.searchParams.get('dealId') || '').trim();
	if (!dealId) {
		return json({ error: 'Missing dealId' }, { status: 400 });
	}

	try {
		const authorized = await authorizeClientForDeal(session, dealId);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this client' }, { status: 403 });
		}

		const orders = await getChangeOrdersForDeal(dealId);
		return json({ data: orders });
	} catch (err) {
		console.error('[client/change-orders] GET failed:', err);
		const message = err instanceof Error ? err.message : 'Failed to load change orders';
		return json({ error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('portal_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = await getSession(token);
	if (!session || new Date(session.expires_at) < new Date()) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const dealId = String(body?.deal_id || '').trim();
		const note = typeof body?.note === 'string' ? body.note.trim() : '';
		const photoIdsRaw = body?.photo_ids;

		if (!dealId) {
			return json({ error: 'Missing required field: deal_id' }, { status: 400 });
		}
		if (!note) {
			return json({ error: 'Please describe the change you would like to request.' }, {
				status: 400
			});
		}
		if (
			photoIdsRaw !== undefined &&
			photoIdsRaw !== null &&
			(!Array.isArray(photoIdsRaw) || !photoIdsRaw.every((item: unknown) => typeof item === 'string'))
		) {
			return json({ error: 'Invalid photo_ids' }, { status: 400 });
		}
		const photoIds: string[] | null = Array.isArray(photoIdsRaw) && photoIdsRaw.length > 0
			? photoIdsRaw
			: null;

		const authorized = await authorizeClientForDeal(session, dealId);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this client' }, { status: 403 });
		}

		const { accessToken, apiDomain } = await getAccessTokenAndDomain();
		const dealName = await fetchDealName(accessToken, apiDomain, dealId);

		// ── Step A: write Field_Updates record → triggers Cliq workflow ────────
		let zohoRecordId: string | null = null;
		try {
			const result = await createCrmFieldUpdate({
				accessToken,
				apiDomain,
				dealId,
				updateType: 'change_order',
				note,
				submitter: {
					name:
						session.client.full_name ||
						[session.client.first_name, session.client.last_name]
							.filter(Boolean)
							.join(' ')
							.trim() ||
						null,
					company: session.client.company || null,
					email: session.client.email
				},
				photoIds
			});
			zohoRecordId = result.zohoRecordId;
		} catch (err) {
			console.error('[client/change-orders] Field_Updates write failed:', err);
			const message = err instanceof Error ? err.message : 'Failed to notify office';
			return json({ error: message }, { status: 502 });
		}

		// ── Step A2: direct Cliq chat post (best-effort) ────────────────────────
		const submitterDisplay =
			session.client.full_name ||
			[session.client.first_name, session.client.last_name]
				.filter(Boolean)
				.join(' ')
				.trim() ||
			session.client.email;
		const cliqLines = [
			`🛠️ *Change Order Request*`,
			`*Project:* ${dealName || dealId}`,
			`*Submitted by:* ${submitterDisplay} (${session.client.email})`,
			'',
			note
		];
		if (Array.isArray(photoIds) && photoIds.length > 0) {
			cliqLines.push('', `_${photoIds.length} attachment${photoIds.length === 1 ? '' : 's'} uploaded._`);
		}
		const cliqResult = await postCliqChatMessage(accessToken, CLIQ_CO_CHAT_ID, {
			text: cliqLines.join('\n')
		});
		if (!cliqResult.ok) {
			console.error(
				`[client/change-orders] Cliq post failed (${cliqResult.via}):`,
				cliqResult.status,
				cliqResult.error
			);
		}

		// ── Step B: Books estimate (quote) draft ────────────────────────────────
		let booksEstimateId: string | null = null;
		let booksSkippedReason: string | null = null;
		try {
			const customer = await getBooksCustomerByEmail(accessToken, session.client.email);
			if (!customer?.contact_id) {
				booksSkippedReason = 'no_customer';
			} else {
				const reference = `CO – ${dealName || 'Deal'} – ${formatTimestampForReference()}`;
				const description = note.length > 500 ? `${note.slice(0, 497)}...` : note;
				const estimate = await createBooksEstimateDraft(accessToken, {
					customer_id: customer.contact_id,
					reference_number: reference,
					customer_notes: note,
					line_items: [
						{
							description,
							quantity: 1,
							rate: 0
						}
					]
				});
				booksEstimateId = estimate?.estimate_id || null;
			}
		} catch (err) {
			console.error('[client/change-orders] Books estimate create failed:', err);
			booksSkippedReason = err instanceof Error ? err.message : 'books_error';
		}

		// ── Step C: attach photos to Books estimate (best-effort) ──────────────
		if (booksEstimateId && photoIds) {
			for (const storagePath of photoIds) {
				if (isVideoPath(storagePath)) continue; // skip videos — too large/long
				try {
					const { data, error } = await supabase.storage
						.from('trade-photos')
						.download(storagePath);
					if (error || !data) {
						console.warn(
							`[client/change-orders] Could not download ${storagePath}:`,
							error?.message
						);
						continue;
					}
					const buffer = await data.arrayBuffer();
					if (buffer.byteLength > BOOKS_ATTACHMENT_SIZE_LIMIT) {
						console.info(
							`[client/change-orders] Skipping Books attachment ${storagePath} — exceeds 10MB`
						);
						continue;
					}
					const fileName = storagePath.split('/').pop() || 'attachment';
					const ext = fileName.split('.').pop()?.toLowerCase() || '';
					const mimeType = FILE_MIME_MAP[ext] || 'application/octet-stream';
					await attachFileToBooksEstimate(accessToken, booksEstimateId, {
						name: fileName,
						mimeType,
						bytes: buffer
					});
				} catch (err) {
					console.warn(`[client/change-orders] Books attachment failed for ${storagePath}:`, err);
				}
			}
		}

		// ── Step D: persist Supabase row for /admin/change-orders ──────────────
		let created: any = null;
		try {
			created = await createChangeOrder({
				deal_id: dealId,
				title: `Client request – ${dealName || 'Project'}`,
				description: note,
				estimated_amount: null,
				approved_amount: null,
				status: 'identified',
				identified_by: session.client.email
			});
		} catch (err) {
			console.error('[client/change-orders] Supabase create failed:', err);
		}

		return json(
			{
				data: {
					...(created || {}),
					zoho_record_id: zohoRecordId,
					books_estimate_id: booksEstimateId,
					books_skipped_reason: booksSkippedReason,
					cliq: cliqResult.ok
						? { ok: true, via: cliqResult.via }
						: {
								ok: false,
								via: cliqResult.via,
								status: cliqResult.status ?? null,
								error: cliqResult.error
							}
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		console.error('[client/change-orders] POST failed:', err);
		const message = err instanceof Error ? err.message : 'Failed to submit change order';
		return json({ error: message }, { status: 500 });
	}
};
