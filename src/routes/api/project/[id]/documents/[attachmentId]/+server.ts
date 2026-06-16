import { error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getZohoApiBase } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import type { RequestHandler } from './$types';

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
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw error(500, 'Zoho tokens not configured');
	}

	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
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
	console.log('[DOC PROXY] Request received', { dealId, attachmentId, codePath: 'CRM attachment' });
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
