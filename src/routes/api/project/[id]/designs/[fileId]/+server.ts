import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getWorkDriveDownloadCandidates } from '$lib/server/workdrive';
import { refreshAccessToken } from '$lib/server/zoho';

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

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
	}
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw error(500, 'Zoho tokens not configured');

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

function extractFileNameFromDisposition(disposition: string | null) {
	if (!disposition) return '';
	const filenameStarMatch = disposition.match(/filename\*\s*=\s*([^;]+)/i);
	if (filenameStarMatch?.[1]) {
		const raw = filenameStarMatch[1].trim().replace(/^["']|["']$/g, '');
		const parts = raw.split("''");
		if (parts.length === 2) {
			try { return decodeURIComponent(parts[1]); } catch { return parts[1]; }
		}
		return raw;
	}
	const filenameMatch = disposition.match(/filename\s*=\s*([^;]+)/i);
	if (filenameMatch?.[1]) return filenameMatch[1].trim().replace(/^["']|["']$/g, '');
	return '';
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	const fileId = String(params.fileId || '').trim();
	if (!dealId || !fileId) throw error(400, 'Deal ID and file ID are required');

	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '') === dealId)) {
		throw error(403, 'Access denied');
	}

	const { accessToken, apiDomain } = await getAccessToken();
	const candidates = getWorkDriveDownloadCandidates(apiDomain);
	let lastStatus = 500;
	let lastMessage = '';

	for (const base of candidates) {
		const downloadUrl = `${base.replace(/\/$/, '')}/${encodeURIComponent(fileId)}`;
		const response = await fetch(downloadUrl, {
			method: 'GET',
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
		});

		if (!response.ok) {
			lastStatus = response.status;
			lastMessage = await response.text().catch(() => '');
			continue;
		}

		const contentType = response.headers.get('content-type') || 'application/octet-stream';
		const disposition = dispositionFor(contentType);

		const headers = new Headers();
		headers.set('Content-Type', contentType);

		const contentLength = response.headers.get('content-length');
		if (contentLength) {
			headers.set('Content-Length', contentLength);
		}

		const nameFromQuery = url.searchParams.get('fileName') || '';
		const nameFromHeader = extractFileNameFromDisposition(response.headers.get('content-disposition'));
		const finalName = safeFileName(nameFromQuery || nameFromHeader || fileId || 'file');
		headers.set('Content-Disposition', `${disposition}; filename="${finalName}"`);

		return new Response(response.body, { status: 200, headers });
	}

	throw error(lastStatus, lastMessage || 'Failed to download file');
};
