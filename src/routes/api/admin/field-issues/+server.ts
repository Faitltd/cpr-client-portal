import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getFieldIssuesForDeal, updateFieldIssueStatus } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const dealId = url.searchParams.get('dealId');
	if (!dealId) return json({ error: 'dealId required' }, { status: 400 });

	try {
		const issues = await getFieldIssuesForDeal(dealId);
		return json({ data: issues });
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Failed to fetch field issues';
		return json({ error }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { id, status } = body ?? {};
	let { resolved_at } = body ?? {};

	if (!id) return json({ error: 'id required' }, { status: 400 });
	if (!status) return json({ error: 'status required' }, { status: 400 });
	if (!['open', 'acknowledged', 'resolved'].includes(String(status))) {
		return json({ error: 'Invalid status' }, { status: 400 });
	}

	if (status === 'resolved' && !resolved_at) {
		resolved_at = new Date().toISOString();
	}

	try {
		const updated = await updateFieldIssueStatus(String(id), String(status), resolved_at ?? undefined);
		return json({ data: updated });
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Failed to update field issue';
		return json({ error }, { status: 500 });
	}
};
