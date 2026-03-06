import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { createApproval, getApprovalsForDeal, getPendingApprovalsForDeal } from '$lib/server/db';
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
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });

	const status = url.searchParams.get('status');
	const assignedTo = url.searchParams.get('assignedTo') as 'client' | 'admin' | null;

	try {
		if (status === 'pending') {
			const data = await getPendingApprovalsForDeal(dealId, assignedTo ?? undefined);
			return json({ data });
		}
		const data = await getApprovalsForDeal(dealId);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch approvals';
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

	const { dealId, title, description, category, assignedTo, priority, dueDate } = body ?? {};
	if (!dealId || !title) return json({ message: 'dealId and title are required' }, { status: 400 });

	try {
		const data = await createApproval({
			deal_id: String(dealId),
			title: String(title),
			description: description ? String(description) : null,
			category: category ?? 'general',
			assigned_to: assignedTo ?? 'client',
			status: 'pending',
			priority: priority ?? 'normal',
			due_date: dueDate ? String(dueDate) : null,
			created_by: 'admin'
		});
		return json({ data }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to create approval';
		return json({ message }, { status: 500 });
	}
};
