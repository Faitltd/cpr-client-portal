import { json, error } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { crmApiCall } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * GET /api/client/emails/:messageId?dealId=...
 *
 * Returns the full body of a single CRM email so the client dashboard can
 * expand the row inline. The list endpoint only returns subject + summary
 * (Zoho truncates `content` in list views); this endpoint hits the per-email
 * detail endpoint to get the unredacted body.
 *
 * Scoped to the authenticated homeowner — the requested dealId must belong
 * to one of the client's deals, otherwise we 403.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const sessionToken = cookies.get('portal_session');
	const messageId = params.messageId;
	const dealId = url.searchParams.get('dealId') || '';

	if (!messageId) throw error(400, 'messageId required');
	if (!dealId) throw error(400, 'dealId required');

	const context = await getClientDashboardContext(sessionToken);
	if (!context) throw error(401, 'Unauthorized');

	const ownsDeal = context.deals.some((d: any) => String(d?.id || '').trim() === dealId);
	if (!ownsDeal) throw error(403, 'Access denied to this project');

	// Zoho's per-email endpoint for a related record returns full content.
	// Try a couple of shapes — different Zoho instances return slightly
	// different keys; the response is always a single email object.
	let resp: any = null;
	try {
		resp = await crmApiCall(`/Deals/${dealId}/Emails/${encodeURIComponent(messageId)}`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[client/emails/${messageId}] /Deals/{id}/Emails/{messageId} failed:`, msg);
	}
	if (!resp?.Emails && !resp?.email && !resp?.data) {
		try {
			resp = await crmApiCall(`/Emails/${encodeURIComponent(messageId)}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[client/emails/${messageId}] /Emails/{messageId} failed:`, msg);
		}
	}

	const email =
		(Array.isArray(resp?.Emails) && resp.Emails[0]) ||
		(Array.isArray(resp?.email) && resp.email[0]) ||
		(Array.isArray(resp?.data) && resp.data[0]) ||
		resp?.Emails ||
		resp?.email ||
		resp?.data ||
		resp ||
		null;

	if (!email || typeof email !== 'object') {
		return json({ body: null, content: null, error: 'Email not found' }, { status: 404 });
	}

	// Zoho returns the body in `content` (HTML or plain) on most accounts.
	// Other accounts surface it as `body` or `message`. Return whichever
	// is non-empty; the UI sanitizes HTML before rendering.
	const content: string | null =
		(typeof email.content === 'string' && email.content) ||
		(typeof email.body === 'string' && email.body) ||
		(typeof email.message === 'string' && email.message) ||
		null;

	return json({
		messageId,
		subject: email.subject ?? null,
		from: email.from ?? null,
		to: Array.isArray(email.to) ? email.to : [],
		time: email.time ?? null,
		content
	});
};
