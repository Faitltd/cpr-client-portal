import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getScopeDefinition, upsertScopeDefinition, updateScopeStatus } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const data = await getScopeDefinition(params.dealId);
		if (!data) return json({ message: 'Scope definition not found' }, { status: 404 });
		return json({ data });
	} catch (err) {
		console.error('GET /api/admin/scope/[dealId] error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch scope definition';
		return json({ message }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	try {
		// Status-only shortcut
		if (Object.keys(body).length === 1 && body.status !== undefined) {
			const data = await updateScopeStatus(params.dealId, body.status);
			return json({ data });
		}

		// Full merge: fetch existing, overlay incoming fields
		const existing = await getScopeDefinition(params.dealId);
		if (!existing) return json({ message: 'Scope definition not found' }, { status: 404 });

		const data = await upsertScopeDefinition({
			deal_id: params.dealId,
			project_type: body.projectType !== undefined ? body.projectType : existing.project_type,
			areas: body.areas !== undefined ? body.areas : existing.areas,
			included_items: body.includedItems !== undefined ? body.includedItems : existing.included_items,
			excluded_items: body.excludedItems !== undefined ? body.excludedItems : existing.excluded_items,
			selections_needed: body.selectionsNeeded !== undefined ? body.selectionsNeeded : existing.selections_needed,
			permit_required: body.permitRequired !== undefined ? body.permitRequired : existing.permit_required,
			long_lead_items: body.longLeadItems !== undefined ? body.longLeadItems : existing.long_lead_items,
			special_conditions: body.specialConditions !== undefined ? body.specialConditions : existing.special_conditions,
			trade_notes: body.tradeNotes !== undefined ? body.tradeNotes : existing.trade_notes,
			status: body.status !== undefined ? body.status : existing.status
		});
		return json({ data });
	} catch (err) {
		console.error('PATCH /api/admin/scope/[dealId] error:', err);
		const message = err instanceof Error ? err.message : 'Failed to update scope definition';
		return json({ message }, { status: 500 });
	}
};
