import { json } from '@sveltejs/kit';
import {
	isNoAdminTokensError,
	isNotFoundError,
	requireDesigner,
	updateDeal
} from '$lib/server/designer';
import {
	getPendingPushesForDeal,
	markDesignerNotePushError,
	markDesignerNotePushed
} from '$lib/server/designer-notes';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.push-notes');
const DEAL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Retry-push any portal-cached Ball_In_Court / Ball_In_Court_Note edits to
 * Zoho. Use when the original PATCH succeeded against the cache but the
 * Zoho call failed (token expired, network blip, 5xx, etc.).
 *
 * Returns:
 *  { pushed: [{ field, value }], failed: [{ field, message }], pending: 0 }
 */
export const POST: RequestHandler = async ({ cookies, params }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (typeof dealId !== 'string' || !DEAL_ID_RE.test(dealId)) {
		return json({ message: 'Invalid deal id.' }, { status: 400 });
	}

	const pending = await getPendingPushesForDeal(dealId);
	if (pending.length === 0) {
		return json({ pushed: [], failed: [], pending: 0, message: 'Nothing to push.' });
	}

	// Build the single Zoho PATCH from all pending fields. One round-trip.
	const fields: Record<string, unknown> = {};
	for (const row of pending) {
		fields[row.field] = row.value;
	}

	try {
		const result = await updateDeal(dealId, fields);
		if (!result.ok) {
			for (const row of pending) await markDesignerNotePushError(row.id, result.message);
			return json(
				{
					pushed: [],
					failed: pending.map((r) => ({ field: r.field, message: result.message })),
					pending: pending.length
				},
				{ status: 422 }
			);
		}
		for (const row of pending) await markDesignerNotePushed(row.id);
		return json({
			pushed: pending.map((r) => ({ field: r.field, value: r.value })),
			failed: [],
			pending: 0,
			deal: result.deal
		});
	} catch (err) {
		if (isNotFoundError(err)) return json({ message: 'Deal not found.' }, { status: 404 });
		const message = err instanceof Error ? err.message : 'Push failed';
		for (const row of pending) await markDesignerNotePushError(row.id, message);
		if (isNoAdminTokensError(err)) {
			return json(
				{ message: 'Zoho CRM is not connected. An admin must complete OAuth first.' },
				{ status: 503 }
			);
		}
		log.error('push-notes failed', { dealId, error: message });
		return json({ message }, { status: 502 });
	}
};

/**
 * Read the current cache state for the deal — used by the UI to decide
 * whether to show the "Push to Zoho" button and how many fields are pending.
 */
export const GET: RequestHandler = async ({ cookies, params }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const dealId = params.dealId;
	if (typeof dealId !== 'string' || !DEAL_ID_RE.test(dealId)) {
		return json({ message: 'Invalid deal id.' }, { status: 400 });
	}

	const pending = await getPendingPushesForDeal(dealId);
	return json({
		pending: pending.length,
		fields: pending.map((r) => ({
			field: r.field,
			value: r.value,
			edited_at: r.edited_at,
			edited_by: r.edited_by,
			push_error: r.push_error
		}))
	});
};
