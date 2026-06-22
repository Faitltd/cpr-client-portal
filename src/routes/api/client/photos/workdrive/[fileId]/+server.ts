import { getTradeSession, getSession } from '$lib/server/db';
import { isValidAdminSession } from '$lib/server/admin';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { downloadWorkDriveFile } from '$lib/server/workdrive';
import type { RequestHandler } from './$types';

/**
 * Stream a WorkDrive image to the browser. Clients have no Zoho account, so a
 * WorkDrive share/file URL won't render as <img>. This proxy downloads the
 * bytes server-side (with the app's Zoho token) and returns them inline, so
 * the deal's WorkDrive "Client Portal/Photos" gallery renders like the
 * Supabase photos do. Any authenticated portal/trade/admin session may fetch.
 */
const EXT_CONTENT_TYPE: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif',
	bmp: 'image/bmp',
	tif: 'image/tiff',
	tiff: 'image/tiff'
};

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const tradeToken = cookies.get('trade_session');
	const portalToken = cookies.get('portal_session');
	const adminToken = cookies.get('admin_session');

	let authenticated = false;
	if (tradeToken) {
		const session = await getTradeSession(tradeToken).catch(() => null);
		if (session && new Date(session.expires_at) > new Date()) authenticated = true;
	}
	if (!authenticated && portalToken) {
		const session = await getSession(portalToken).catch(() => null);
		if (session) authenticated = true;
	}
	if (!authenticated && adminToken && isValidAdminSession(adminToken)) authenticated = true;
	if (!authenticated) return new Response('Unauthorized', { status: 401 });

	const fileId = (params.fileId ?? '').trim();
	if (!fileId) return new Response('Not found', { status: 404 });

	const valid = await ensureValidZohoToken();
	if (!valid) return new Response('Service unavailable', { status: 503 });

	let bytes: Buffer;
	try {
		bytes = await downloadWorkDriveFile(valid.accessToken, fileId, valid.apiDomain);
	} catch (err) {
		console.warn('[client/photos/workdrive] download failed:', fileId, err instanceof Error ? err.message : err);
		return new Response('Not found', { status: 404 });
	}

	const name = url.searchParams.get('n') ?? '';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const contentType = EXT_CONTENT_TYPE[ext] || 'image/jpeg';

	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'private, max-age=3600',
			'Content-Length': String(bytes.length)
		}
	});
};
