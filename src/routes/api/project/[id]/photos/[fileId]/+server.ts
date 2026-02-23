import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { getWorkDriveDownloadCandidates } from '$lib/server/workdrive';
import { refreshAccessToken } from '$lib/server/zoho';

function safeFileName(value: string) {
	return value.replace(/[^\x20-\x7E]/g, '_').replace(/[/\\]/g, '_').replace(/"/g, "'");
}

function isImageContentType(value: string | null) {
	if (!value) return false;
	return value.toLowerCase().startsWith('image/');
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	tiff: 'image/tiff',
	tif: 'image/tiff',
	ico: 'image/x-icon',
	heic: 'image/heic',
	heif: 'image/heif',
	avif: 'image/avif'
};

function inferImageMime(name: string) {
	const ext = String(name || '').split('.').pop()?.toLowerCase() || '';
	return IMAGE_EXTENSIONS[ext] || '';
}

function normalizeImageContentType(value: string | null) {
	if (!value) return '';
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return '';
	return trimmed;
}

function extractFileNameFromDisposition(disposition: string | null) {
	if (!disposition) return '';
	const filenameStarMatch = disposition.match(/filename\*\s*=\s*([^;]+)/i);
	if (filenameStarMatch?.[1]) {
		const raw = filenameStarMatch[1].trim().replace(/^["']|["']$/g, '');
		const parts = raw.split("''");
		if (parts.length === 2) {
			try {
				return decodeURIComponent(parts[1]);
			} catch {
				return parts[1];
			}
		}
		return raw;
	}

	const filenameMatch = disposition.match(/filename\s*=\s*([^;]+)/i);
	if (filenameMatch?.[1]) {
		return filenameMatch[1].trim().replace(/^["']|["']$/g, '');
	}
	return '';
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

async function canClientAccessDeal(session: Awaited<ReturnType<typeof getSession>>, dealId: string) {
	if (!session?.client) return false;
	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	return deals.some((deal) => String(deal?.id || '') === dealId);
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	const fileId = String(params.fileId || '').trim();
	if (!dealId || !fileId) throw error(400, 'Deal ID and file ID are required');

	if (!(await canClientAccessDeal(session, dealId))) {
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
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`
			}
		});

		if (!response.ok) {
			lastStatus = response.status;
			lastMessage = await response.text().catch(() => '');
			continue;
		}

		const headers = new Headers();
		const headerContentType = normalizeImageContentType(response.headers.get('content-type'));
		const requestedMime = normalizeImageContentType(url.searchParams.get('mime'));
		const nameFromQuery = url.searchParams.get('fileName') || '';
		const nameFromHeader = extractFileNameFromDisposition(
			response.headers.get('content-disposition')
		);
		const inferredMime = inferImageMime(nameFromQuery || nameFromHeader || '');
		const contentType =
			isImageContentType(headerContentType) ? headerContentType
			: isImageContentType(requestedMime) ? requestedMime
			: isImageContentType(inferredMime) ? inferredMime
			: headerContentType || 'application/octet-stream';
		headers.set('Content-Type', contentType);
		const finalName = safeFileName(nameFromQuery || nameFromHeader || fileId || 'photo');
		headers.set('Content-Disposition', `inline; filename="${finalName}"`);

		return new Response(response.body, {
			status: response.status,
			headers
		});
	}

	throw error(lastStatus, lastMessage || 'Failed to download WorkDrive file');
};
