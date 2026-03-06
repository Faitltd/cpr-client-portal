import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getCommsForDeal, logComm } from '$lib/server/db';
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

	try {
		const data = await getCommsForDeal(dealId);
		return json({ data });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch comms';
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

	const { dealId, channel, subject, summary, contactedBy, direction, slaTargetHours } = body ?? {};
	if (!dealId || !channel) return json({ message: 'dealId and channel are required' }, { status: 400 });

	try {
		const data = await logComm({
			deal_id: String(dealId),
			channel,
			direction: direction ?? 'outbound',
			subject: subject ? String(subject) : null,
			summary: summary ? String(summary) : null,
			contacted_by: contactedBy ? String(contactedBy) : null,
			sla_target_hours: slaTargetHours ?? 48
		});
		return json({ data }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to log comm';
		return json({ message }, { status: 500 });
	}
};
