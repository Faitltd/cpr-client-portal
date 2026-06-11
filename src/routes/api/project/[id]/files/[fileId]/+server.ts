import { error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { getDealsForClient } from '$lib/server/projects';
import { refreshAccessToken } from '$lib/server/zoho';
import { listClientPortalFiles } from '$lib/server/client-portal-files';
import { downloadWorkDriveFile } from '$lib/server/workdrive';
import type { RequestHandler } from './$types';

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
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope
		});
	}
	return { accessToken, apiDomain };
}

// WorkDrive often reports no usable mime type, which forces a download.
// Derive the content type from the extension so browsers render what they
// can (PDFs, images, video, text) inline.
const EXT_MIME: Record<string, string> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	heic: 'image/heic',
	bmp: 'image/bmp',
	txt: 'text/plain; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav'
};

function resolveContentType(name: string, mime: string | null): string {
	const ext = (name.split('.').pop() || '').toLowerCase();
	const fromExt = EXT_MIME[ext];
	if (fromExt) return fromExt;
	if (mime && mime !== 'application/octet-stream' && mime.includes('/')) return mime;
	return 'application/octet-stream';
}

/**
 * Streams a single document from the deal's Client Portal folder through the
 * org's Zoho token. Only files that actually live in that folder (or its
 * immediate subfolders) are served, so the client session can't fetch
 * arbitrary WorkDrive files.
 */
export const GET: RequestHandler = async ({ cookies, params, setHeaders }) => {
	const sessionToken = cookies.get('portal_session');
	if (!sessionToken) throw error(401, 'Not authenticated');

	const session = await getSession(sessionToken);
	if (!session?.client) throw error(401, 'Invalid session');

	const dealId = String(params.id || '').trim();
	const fileId = String(params.fileId || '').trim();
	if (!dealId || !fileId) throw error(400, 'Deal ID and file ID required');

	const deals = await getDealsForClient(session.client.zoho_contact_id, session.client.email);
	if (!deals.some((deal: any) => String(deal?.id || '').trim() === dealId)) {
		throw error(403, 'Access denied to this project');
	}

	const { accessToken, apiDomain } = await getAccessToken();

	const { files } = await listClientPortalFiles(accessToken, dealId, apiDomain);
	const file = files.find((f) => f.id === fileId);
	if (!file) throw error(404, 'Document not found in this project');

	let buffer: Buffer;
	try {
		buffer = await downloadWorkDriveFile(accessToken, fileId, apiDomain);
	} catch {
		throw error(502, 'Unable to download this document right now');
	}

	const safeName = file.name.replace(/["\\\r\n]/g, '');
	setHeaders({
		'Content-Type': resolveContentType(file.name, file.mime),
		'Content-Disposition': `inline; filename="${safeName}"`,
		'Cache-Control': 'private, max-age=300'
	});
	return new Response(new Uint8Array(buffer));
};
