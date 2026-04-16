import { json } from '@sveltejs/kit';
import {
	createDealNote,
	getDealNotes,
	isNoAdminTokensError,
	isNotFoundError,
	requireDesigner
} from '$lib/server/designer';
import { createLogger } from '$lib/server/logger';
import type { ApiErrorResponse, NoteResponse, NotesResponse } from '$lib/types/designer';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.notes');

const DEAL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_NOTE_LENGTH = 32000;

function validateDealId(dealId: string | undefined): dealId is string {
	return typeof dealId === 'string' && DEAL_ID_RE.test(dealId);
}

export const GET: RequestHandler = async ({ cookies, params }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (!validateDealId(dealId)) {
		const payload: ApiErrorResponse = { message: 'Invalid deal id.' };
		return json(payload, { status: 400 });
	}

	try {
		const notes = await getDealNotes(dealId);
		const payload: NotesResponse = { notes };
		return json(payload);
	} catch (err) {
		if (isNotFoundError(err)) {
			const payload: ApiErrorResponse = { message: 'Deal not found.' };
			return json(payload, { status: 404 });
		}
		if (isNoAdminTokensError(err)) {
			const payload: ApiErrorResponse = {
				message: 'Zoho CRM is not connected. An admin must complete OAuth first.'
			};
			return json(payload, { status: 503 });
		}
		const message = err instanceof Error ? err.message : 'Unable to load notes';
		log.error('getDealNotes failed', { dealId, error: message });
		const payload: ApiErrorResponse = { message };
		return json(payload, { status: 502 });
	}
};

export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (!validateDealId(dealId)) {
		const payload: ApiErrorResponse = { message: 'Invalid deal id.' };
		return json(payload, { status: 400 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		const payload: ApiErrorResponse = { message: 'Request body must be valid JSON.' };
		return json(payload, { status: 400 });
	}

	const content = typeof body?.content === 'string' ? body.content.trim() : '';
	if (!content) {
		const payload: ApiErrorResponse = { message: 'Note content is required.' };
		return json(payload, { status: 422 });
	}
	if (content.length > MAX_NOTE_LENGTH) {
		const payload: ApiErrorResponse = {
			message: `Note content exceeds max length of ${MAX_NOTE_LENGTH} characters.`
		};
		return json(payload, { status: 422 });
	}

	try {
		const note = await createDealNote(dealId, content);
		const payload: NoteResponse = { note };
		return json(payload, { status: 201 });
	} catch (err) {
		if (isNotFoundError(err)) {
			const payload: ApiErrorResponse = { message: 'Deal not found.' };
			return json(payload, { status: 404 });
		}
		if (isNoAdminTokensError(err)) {
			const payload: ApiErrorResponse = {
				message: 'Zoho CRM is not connected. An admin must complete OAuth first.'
			};
			return json(payload, { status: 503 });
		}
		const message = err instanceof Error ? err.message : 'Unable to create note';
		log.error('createDealNote failed', { dealId, error: message });
		const payload: ApiErrorResponse = { message };
		return json(payload, { status: 502 });
	}
};
