import { json } from '@sveltejs/kit';
import { supabase, getTradeSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const BUCKET = 'trade-photos';

/**
 * POST /api/trade/photos/upload-url
 *
 * Returns a short-lived Supabase signed upload URL so the browser can PUT a
 * video (or any large file) directly to Supabase Storage without routing the
 * bytes through the Node server. This avoids proxy timeouts on large uploads.
 *
 * Body: { filename: string, mimeType: string }
 * Response: { data: { signedUrl, path, url, name } }
 */
export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = await getTradeSession(token).catch(() => null);
	if (!session || new Date(session.expires_at) < new Date()) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const filename = String(body?.filename || '').trim();
	const mimeType = String(body?.mimeType || 'application/octet-stream').trim();

	if (!filename) return json({ error: 'filename required' }, { status: 400 });

	const rawExt = filename.split('.').pop()?.toLowerCase() || '';
	const ext = rawExt || (mimeType.startsWith('video/') ? 'mp4' : 'jpg');

	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 8);
	const storagePath = `${session.trade_partner_id}/${timestamp}-${random}.${ext}`;

	const { data, error } = await supabase.storage
		.from(BUCKET)
		.createSignedUploadUrl(storagePath);

	if (error || !data) {
		console.error('[upload-url] Failed to create signed URL:', error?.message);
		return json({ error: 'Failed to create upload URL' }, { status: 500 });
	}

	return json({
		data: {
			signedUrl: data.signedUrl,
			path: storagePath,
			url: `/api/trade/photos/storage/${storagePath}`,
			name: filename
		}
	});
};
