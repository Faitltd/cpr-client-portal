import { supabase, getTradeSession, getSession } from '$lib/server/db';
import { isValidAdminSession } from '$lib/server/admin';
import type { RequestHandler } from './$types';

const BUCKET = 'trade-photos';

const EXT_CONTENT_TYPE: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif'
};

export const GET: RequestHandler = async ({ params, cookies }) => {
	// Accept trade, client (portal), or admin sessions
	const tradeToken = cookies.get('trade_session');
	const portalToken = cookies.get('portal_session');
	const adminToken = cookies.get('admin_session');

	let authenticated = false;

	if (tradeToken) {
		const session = await getTradeSession(tradeToken);
		if (session && new Date(session.expires_at) > new Date()) authenticated = true;
	}
	if (!authenticated && portalToken) {
		const session = await getSession(portalToken);
		if (session) authenticated = true;
	}
	if (!authenticated && adminToken) {
		if (isValidAdminSession(adminToken)) authenticated = true;
	}

	if (!authenticated) {
		return new Response('Unauthorized', { status: 401 });
	}

	const storagePath = params.path;
	if (!storagePath) {
		return new Response('Not found', { status: 404 });
	}

	const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);

	if (error || !data) {
		return new Response('Not found', { status: 404 });
	}

	const ext = storagePath.split('.').pop()?.toLowerCase() || 'jpg';
	const contentType = EXT_CONTENT_TYPE[ext] || 'image/jpeg';
	const arrayBuffer = await data.arrayBuffer();

	return new Response(arrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'private, max-age=3600',
			'Content-Length': String(arrayBuffer.byteLength)
		}
	});
};
