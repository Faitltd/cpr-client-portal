import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getScopeDefinition, upsertScopeDefinition, listScopeDefinitions } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = url.searchParams.get('dealId');
	const status = url.searchParams.get('status');

	try {
		if (dealId) {
			const data = await getScopeDefinition(dealId);
			return json({ data });
		}
		const data = await listScopeDefinitions(status ?? undefined);
		return json({ data });
	} catch (err) {
		console.error('GET /api/admin/scope error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch scope definitions';
		return json({ message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const { dealId, projectType } = body ?? {};
	if (!dealId || !projectType) {
		return json({ message: 'dealId and projectType are required' }, { status: 400 });
	}

	try {
		const data = await upsertScopeDefinition({
			deal_id: String(dealId),
			project_type: String(projectType),
			areas: body.areas ?? [],
			included_items: body.includedItems ?? [],
			excluded_items: body.excludedItems ?? [],
			selections_needed: body.selectionsNeeded ?? [],
			permit_required: body.permitRequired ?? false,
			long_lead_items: body.longLeadItems ?? [],
			special_conditions: body.specialConditions ?? {},
			trade_notes: body.tradeNotes ?? null,
			status: body.status ?? 'draft'
		});
		return json({ data }, { status: 201 });
	} catch (err) {
		console.error('POST /api/admin/scope error:', err);
		const message = err instanceof Error ? err.message : 'Failed to upsert scope definition';
		return json({ message }, { status: 500 });
	}
};
