import { json } from '@sveltejs/kit';
import { getBotAccess, buildClientBotAccess } from '$lib/server/bot-access';
import { getPortalPrincipal } from '$lib/server/designer';
import { runChat, type ChatMessage } from '$lib/server/bot/chat';
import { getDealsForClient } from '$lib/server/projects';
import type { RequestHandler } from './$types';

interface ChatRequestBody {
	dealId?: string;
	threadId?: string;
	messages?: ChatMessage[];
}

function isMessage(x: unknown): x is ChatMessage {
	if (!x || typeof x !== 'object') return false;
	const m = x as Record<string, unknown>;
	return (
		(m.role === 'user' || m.role === 'assistant') &&
		typeof m.content === 'string' &&
		m.content.length > 0
	);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	let access = await getBotAccess(cookies);
	// A logged-in client must always reach their own assistant. getBotAccess
	// resolves admin→trade→portal, so a stale trade/admin cookie left in the
	// browser (from testing another role) would otherwise shadow a real client
	// session and 401 them. Re-resolve the client straight from portal_session.
	if (!access || (access.role !== 'client' && access.role !== 'admin')) {
		const principal = await getPortalPrincipal(cookies.get('portal_session'));
		if (principal?.role === 'client') {
			access = buildClientBotAccess(principal.session.client as Record<string, any>);
		}
	}
	if (!access || (access.role !== 'client' && access.role !== 'admin')) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: ChatRequestBody;
	try {
		body = (await request.json()) as ChatRequestBody;
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const dealId = (body.dealId ?? '').trim();
	const threadId = (body.threadId ?? '').trim();
	const messages = Array.isArray(body.messages) ? body.messages.filter(isMessage) : [];
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });
	if (!threadId) return json({ message: 'threadId required' }, { status: 400 });
	if (messages.length === 0) return json({ message: 'messages required' }, { status: 400 });
	if (messages.at(-1)!.role !== 'user') {
		return json({ message: 'Last message must be from user' }, { status: 400 });
	}

	// Enforce that the client owns this Deal. Admins bypass the check so they
	// can test the client view from the dashboard while logged in as admin.
	if (access.role === 'client') {
		// getDealsForClient keys off the Zoho CRM Contact id (+ email fallback),
		// NOT the portal-side client.id. Pass both so the lookup matches.
		const allowed = await getDealsForClient(
			access.clientZohoContactId ?? null,
			access.email || null
		).catch(() => [] as any[]);
		const allowedIds = new Set(
			(allowed ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
		);
		if (!allowedIds.has(dealId)) {
			return json({ message: 'You do not have access to this Deal' }, { status: 403 });
		}
	}

	// When admin previews the client view, apply the SAME restrictions a real
	// client would have so what they see matches the homeowner experience.
	const clientLikeRestrictions = {
		allowedSources: [
			'workdrive_pdf',
			'workdrive_docx',
			'workdrive_xlsx',
			'zoho_crm_field',
			'zoho_books_invoice',
			'zoho_books_payment',
			'zoho_cliq_external',
			'zoho_projects_task',
			'zoho_projects_activity',
			'zoho_sign_request',
			'transcript'
		],
		allowedTopFolders: ['Client Portal', 'Client', 'Homeowner Portal'],
		hideFinancials: false,
		hideInternalFinancials: true
	};
	const effective = access.role === 'admin' ? clientLikeRestrictions : access;

	try {
		const stream = await runChat({
			dealId,
			threadId,
			adminEmail: access.email || 'client',
			messages,
			allowedSources: effective.allowedSources,
			allowedTopFolders: effective.allowedTopFolders,
			hideFinancials: effective.hideFinancials,
			hideInternalFinancials: effective.hideInternalFinancials
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no'
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Chat failed';
		return json({ message }, { status: 500 });
	}
};
