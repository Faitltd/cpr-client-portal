import { json, error } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { crmApiCall } from '$lib/server/projects';
import { supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

function escapeHtml(s: string): string {
	return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/**
 * Fall back to the email body already synced by the assistant's mail ingestion
 * (Zoho Mail API → bot_documents, source 'zoho_mail'). CRM's View Email API
 * only returns bodies for the authorizing user's own/shared emails, so most
 * team correspondence comes back empty; the Mail-ingested copy doesn't have
 * that per-user restriction. Matched by deal + exact subject, newest first.
 */
async function mailBodyFallback(dealId: string, subject: string): Promise<string | null> {
	if (!subject) return null;
	const { data, error: dbErr } = await supabase
		.from('bot_documents')
		.select('body, occurred_at')
		.eq('source', 'zoho_mail')
		.eq('deal_id', dealId)
		.eq('subject', subject)
		.order('occurred_at', { ascending: false })
		.limit(1);
	if (dbErr || !data || data.length === 0) return null;
	const raw = typeof data[0].body === 'string' ? data[0].body : '';
	// Ingestion prepends "Subject:/From:/To:" header lines before a blank line.
	const stripped = raw.replace(/^Subject:[\s\S]*?\n\n/, '').trim();
	if (!stripped) return null;
	return `<div>${escapeHtml(stripped).replace(/\n/g, '<br>')}</div>`;
}

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
	const subjectParam = url.searchParams.get('subject') || '';

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

	// Zoho returns the body in `content` (HTML or plain) when accessible.
	let content: string | null =
		email && typeof email === 'object'
			? (typeof email.content === 'string' && email.content) ||
				(typeof email.body === 'string' && email.body) ||
				(typeof email.message === 'string' && email.message) ||
				null
			: null;

	// CRM View Email is restricted to the token user's own/shared emails, so it
	// usually returns no body for team correspondence. Fall back to the copy the
	// assistant already synced from the Zoho Mail API.
	if (!content) {
		const subject =
			(email && typeof email === 'object' && typeof email.subject === 'string' && email.subject) ||
			subjectParam;
		content = await mailBodyFallback(dealId, subject).catch(() => null);
	}

	return json({
		messageId,
		subject: (email && typeof email === 'object' ? email.subject : null) ?? subjectParam ?? null,
		from: (email && typeof email === 'object' ? email.from : null) ?? null,
		to: email && typeof email === 'object' && Array.isArray(email.to) ? email.to : [],
		time: (email && typeof email === 'object' ? email.time : null) ?? null,
		content
	});
};
