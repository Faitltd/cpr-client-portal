import { json } from '@sveltejs/kit';
import {
	isNoAdminTokensError,
	isNotFoundError,
	requireDesigner,
	updateDeal
} from '$lib/server/designer';
import {
	markDesignerNotePushError,
	markDesignerNotePushed,
	recordDesignerNoteEdit,
	type DesignerNoteField,
	type DesignerNoteRow
} from '$lib/server/designer-notes';
import { createLogger } from '$lib/server/logger';
import type {
	ApiErrorResponse,
	DealUpdateRequest,
	DealUpdateResponse
} from '$lib/types/designer';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.deal');

const DEAL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const CACHED_FIELDS: DesignerNoteField[] = ['Ball_In_Court', 'Ball_In_Court_Note'];

function validateDealId(dealId: string | undefined): dealId is string {
	return typeof dealId === 'string' && DEAL_ID_RE.test(dealId);
}

/**
 * Write any Ball_In_Court / Ball_In_Court_Note fields included in this PATCH
 * to the designer_notes cache BEFORE we attempt the Zoho call. Returns the
 * inserted rows so we can flag them as pushed/failed after the Zoho call.
 */
async function cacheDesignerEdits(
	dealId: string,
	fields: Record<string, unknown>,
	editedBy: string | null
): Promise<DesignerNoteRow[]> {
	const inserted: DesignerNoteRow[] = [];
	for (const field of CACHED_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
		const raw = fields[field];
		const value = typeof raw === 'string' ? raw : raw == null ? null : String(raw);
		try {
			const row = await recordDesignerNoteEdit(dealId, field, value, editedBy);
			inserted.push(row);
		} catch (err) {
			// Don't block the Zoho call if the cache insert fails — log and continue.
			log.warn('cacheDesignerEdits insert failed', {
				dealId,
				field,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}
	return inserted;
}

export const PATCH: RequestHandler = async ({ cookies, params, request }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (!validateDealId(dealId)) {
		const payload: ApiErrorResponse = { message: 'Invalid deal id.' };
		return json(payload, { status: 400 });
	}

	let body: Partial<DealUpdateRequest> & Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		const payload: ApiErrorResponse = { message: 'Request body must be valid JSON.' };
		return json(payload, { status: 400 });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		const payload: ApiErrorResponse = { message: 'Request body must be an object.' };
		return json(payload, { status: 400 });
	}

	const fields =
		body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
			? body.fields
			: (body as Record<string, unknown>);

	if (!fields || Object.keys(fields).length === 0) {
		const payload: ApiErrorResponse = { message: 'At least one field is required.' };
		return json(payload, { status: 422 });
	}

	// Cache Ball_In_Court / Ball_In_Court_Note edits to Supabase BEFORE the
	// Zoho call so the edit survives any Zoho failure. The user can retry the
	// push later via the "Push to Zoho" button.
	const editedBy = auth.session.designer.email ?? null;
	const cachedRows = await cacheDesignerEdits(dealId, fields, editedBy);

	try {
		const result = await updateDeal(dealId, fields);
		if (!result.ok) {
			// Zoho-side reject — record the error on each cached row, but still
			// return 422 so the UI shows why Zoho refused.
			for (const row of cachedRows) {
				await markDesignerNotePushError(row.id, result.message);
			}
			const payload: ApiErrorResponse = { message: result.message };
			return json(payload, { status: 422 });
		}
		// Zoho accepted — mark cached rows as pushed.
		for (const row of cachedRows) {
			await markDesignerNotePushed(row.id);
		}
		const response: DealUpdateResponse = { ok: true, deal: result.deal };
		return json(response);
	} catch (err) {
		if (isNotFoundError(err)) {
			const payload: ApiErrorResponse = { message: 'Deal not found.' };
			return json(payload, { status: 404 });
		}
		// For everything else — auth, network, 5xx — the cache still has the
		// edit. Flag rows with the error message and return 502 so the UI can
		// surface "saved locally; push to Zoho pending."
		const message = err instanceof Error ? err.message : 'Unable to update deal';
		for (const row of cachedRows) {
			await markDesignerNotePushError(row.id, message);
		}
		if (isNoAdminTokensError(err)) {
			const payload: ApiErrorResponse = {
				message: 'Zoho CRM is not connected. An admin must complete OAuth first.',
				cached: cachedRows.length > 0
			};
			return json(payload, { status: 503 });
		}
		log.error('updateDeal failed', { dealId, error: message });
		const payload: ApiErrorResponse = { message, cached: cachedRows.length > 0 };
		return json(payload, { status: 502 });
	}
};
