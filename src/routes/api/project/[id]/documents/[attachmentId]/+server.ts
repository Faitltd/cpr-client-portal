import { error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getZohoApiBase, refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function safeFileName(value: string) {
	return value.replace(/[^\x20-\x7E]/g, '_').replace(/[/\\]/g, '_').replace(/"/g, "'");
}

/** Content types that browsers can display inline (PDFs, images). */
const INLINE_TYPES = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/svg+xml',
	'image/bmp',
	'image/tiff'
]);

function dispositionFor(contentType: string): 'inline' | 'attachment' {
	const lower = (contentType || '').split(';')[0].trim().toLowerCase();
	return INLINE_TYPES.has(lower) ? 'inline' : 'attachment';
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain || undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return { accessToken, apiDomain };
}

async function canClientAccessDeal(
	session: Awaited<ReturnType<typeof getSession>>,
	dealId: string
) {
	if (!session?.client) return false;
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	const session = await getSession(sessionToken);
	if (!session) {
		throw error(401, 'Invalid session');
	}

	const dealId = String(params.id || '').trim();
	const attachmentId = String(params.attachmentId || '').trim();
	if (!dealId || !attachmentId) {
		throw error(400, 'Deal ID and attachment ID are required');
	}

	if (!(await canClientAccessDeal(session, dealId))) {
		throw error(403, 'Access denied');
	}

	const { accessToken, apiDomain } = await getAccessToken();

	const base = getZohoApiBase(apiDomain);
	const downloadUrl = `${base}/Deals/${encodeURIComponent(dealId)}/Attachments/${encodeURIComponent(attachmentId)}/$download`;

	const response = await fetch(downloadUrl, {
		method: 'GET',
		headers: {
			Authorization: `Zoho-oauthtoken ${accessToken}`
		}
	});

	if (!response.ok) {
		const message = await response.text().catch(() => '');
		console.error('[DOC PROXY] Zoho attachment download failed', {
			dealId,
			attachmentId,
			status: response.status,
			body: message.slice(0, 500)
		});
		throw error(response.status === 404 ? 404 : 502, message || 'Failed to download attachment');
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const disposition = dispositionFor(contentType);

	const headers = new Headers();
	headers.set('Content-Type', contentType);

	const contentLength = response.headers.get('content-length');
	if (contentLength) {
		headers.set('Content-Length', contentLength);
	}

	const fileName = safeFileName(url.searchParams.get('fileName') || 'document');
	headers.set('Content-Disposition', `${disposition}; filename="${fileName}"`);

	return new Response(response.body, {
		status: 200,
		headers
	});
};
