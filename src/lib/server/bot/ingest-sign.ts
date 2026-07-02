import { createHash } from 'crypto';
import { supabase } from '$lib/server/db';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { listSignRequestsByRecipient, getRequestDetails } from '$lib/server/sign';
import { chunkText, embed } from './embeddings';
import { resolveEventDate } from './date-util';

export interface SignSyncResult {
	dealId: string;
	customerEmail: string | null;
	requests: { source: 'zoho_sign_request'; processed: number; inserted: number; skipped: number };
	error?: string;
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho not connected');
	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
}

async function fetchDealContactEmail(dealId: string): Promise<string | null> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const dealRes = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Contact_Name,Email,Email_1`,
		{},
		apiDomain
	);
	const rec = dealRes?.data?.[0] ?? {};
	const dealEmail =
		(typeof rec.Email_1 === 'string' && rec.Email_1) ||
		(typeof rec.Email === 'string' && rec.Email) ||
		null;
	if (dealEmail) return dealEmail;

	const contactRef = rec.Contact_Name;
	const contactId =
		contactRef && typeof contactRef === 'object' && 'id' in contactRef
			? String((contactRef as any).id)
			: null;
	if (!contactId) return null;
	try {
		const cRes = await zohoApiCall(
			accessToken,
			`/Contacts/${encodeURIComponent(contactId)}?fields=Email`,
			{},
			apiDomain
		);
		const cRec = cRes?.data?.[0] ?? {};
		return typeof cRec.Email === 'string' ? cRec.Email : null;
	} catch {
		return null;
	}
}

function renderSignRequest(req: any, details: any | null): {
	subject: string;
	body: string;
	sourceId: string;
	occurredAt: string;
	dateEstimated: boolean;
} {
	const id = String(req.request_id ?? req.requestId ?? details?.request_id ?? '');
	const name =
		details?.request_name ??
		req.request_name ??
		req.request_name_display ??
		req.requestname ??
		'Contract';
	const status =
		(details?.request_status ?? req.request_status ?? req.status ?? 'unknown').toString();
	const owner = details?.owner_name ?? req.owner_name ?? '';
	const createdTime = details?.created_time ?? req.created_time ?? '';
	const modifiedTime = details?.modified_time ?? req.modified_time ?? '';
	const signedTime =
		details?.action_completed_time ??
		details?.request_completed_time ??
		req.request_completed_time ??
		'';
	const actions = Array.isArray(details?.actions) ? details.actions : [];

	const lines: string[] = [];
	lines.push(`Document: ${name}`);
	lines.push(`Status: ${status}`);
	if (owner) lines.push(`Owner: ${owner}`);
	if (createdTime) lines.push(`Created: ${createdTime}`);
	if (modifiedTime && modifiedTime !== createdTime) lines.push(`Last updated: ${modifiedTime}`);
	if (signedTime) lines.push(`Completed: ${signedTime}`);

	if (actions.length > 0) {
		lines.push('Recipients:');
		for (const action of actions.slice(0, 20)) {
			const recipientName = action.recipient_name ?? action.recipientName ?? '';
			const recipientEmail = action.recipient_email ?? action.recipientEmail ?? '';
			const actionType = (action.action_type ?? action.actionType ?? '').toString();
			const actionStatus = (action.action_status ?? action.actionStatus ?? 'pending').toString();
			const completedAt = action.signed_time ?? action.completed_time ?? '';
			const role = action.role ?? '';
			const pieces = [
				`- ${recipientName || recipientEmail}`,
				role ? `(${role})` : '',
				actionType ? `· ${actionType}` : '',
				`· ${actionStatus}`,
				completedAt ? `· signed ${completedAt}` : ''
			].filter(Boolean);
			lines.push(pieces.join(' '));
		}
	}

	const docIds = Array.isArray(details?.document_ids) ? details.document_ids : [];
	if (docIds.length > 0) {
		lines.push(`Attached documents: ${docIds.length}`);
	}

	const body = lines.join('\n');
	const { iso: occurredAt, estimated: dateEstimated } = resolveEventDate(
		signedTime,
		modifiedTime,
		createdTime
	);
	return {
		subject: `Sign · ${name} · ${status}`,
		body,
		sourceId: `sign:${id}`,
		occurredAt,
		dateEstimated
	};
}

async function ingestRendered(
	dealId: string,
	source: 'zoho_sign_request',
	author: string | null,
	rec: { subject: string; body: string; sourceId: string; occurredAt: string; dateEstimated?: boolean; metadata?: any }
): Promise<'inserted' | 'skipped'> {
	const docRow = {
		deal_id: dealId,
		source,
		source_id: rec.sourceId,
		source_url: rec.metadata?.view_url ?? null,
		author,
		occurred_at: rec.occurredAt,
		date_estimated: rec.dateEstimated ?? false,
		subject: rec.subject,
		body: rec.body,
		metadata: rec.metadata ?? {},
		hash: hashBody(rec.body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', rec.sourceId)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(`${rec.subject}\n${rec.body}`, 1500, 200);
	if (chunks.length === 0) return 'inserted';
	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

export async function syncSignForDeal(dealId: string): Promise<SignSyncResult> {
	const result: SignSyncResult = {
		dealId,
		customerEmail: null,
		requests: { source: 'zoho_sign_request', processed: 0, inserted: 0, skipped: 0 }
	};

	let email: string | null;
	try {
		email = await fetchDealContactEmail(dealId);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'fetch email failed';
		return result;
	}
	if (!email) {
		result.error = 'no contact email on Deal';
		return result;
	}
	result.customerEmail = email;

	const { accessToken } = await getValidAccessToken();
	let requests: any[];
	try {
		requests = await listSignRequestsByRecipient(accessToken, email);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'sign list failed';
		return result;
	}

	for (const req of requests) {
		const requestId = req.request_id ?? req.requestId;
		if (!requestId) continue;
		let details: any | null = null;
		try {
			details = await getRequestDetails(accessToken, String(requestId));
		} catch {
			/* fall back to summary-only render */
		}
		const rec = renderSignRequest(req, details);
		result.requests.processed += 1;
		try {
			const status = await ingestRendered(dealId, 'zoho_sign_request', email, {
				...rec,
				metadata: {
					request_id: requestId,
					view_url: details?.document_url ?? details?.request_url ?? req.request_url ?? null,
					sign_status: details?.request_status ?? req.request_status ?? null
				}
			});
			if (status === 'inserted') result.requests.inserted += 1;
			else result.requests.skipped += 1;
		} catch (err) {
			result.requests.skipped += 1;
			console.warn(
				'[bot/ingest-sign] request failed:',
				err instanceof Error ? err.message : err
			);
		}
	}

	return result;
}
