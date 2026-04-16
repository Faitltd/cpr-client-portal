import { json } from '@sveltejs/kit';
import {
	isNoAdminTokensError,
	isNotFoundError,
	requireDesigner,
	updateDeal
} from '$lib/server/designer';
import { createLogger } from '$lib/server/logger';
import type {
	ApiErrorResponse,
	DealUpdateRequest,
	DealUpdateResponse
} from '$lib/types/designer';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.deal');

const DEAL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

function validateDealId(dealId: string | undefined): dealId is string {
	return typeof dealId === 'string' && DEAL_ID_RE.test(dealId);
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

	try {
		const result = await updateDeal(dealId, fields);
		if (!result.ok) {
			const payload: ApiErrorResponse = { message: result.message };
			return json(payload, { status: 422 });
		}
		const response: DealUpdateResponse = { ok: true, deal: result.deal };
		return json(response);
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
		const message = err instanceof Error ? err.message : 'Unable to update deal';
		log.error('updateDeal failed', { dealId, error: message });
		const payload: ApiErrorResponse = { message };
		return json(payload, { status: 502 });
	}
};
