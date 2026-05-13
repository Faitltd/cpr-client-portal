import { json } from '@sveltejs/kit';
import { supabase, getTradeSession, getSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const BUCKET = 'trade-photos';

type ResolvedSubmitter =
	| { kind: 'trade'; id: string }
	| { kind: 'client'; id: string };

async function resolveSubmitter(cookies: {
	get: (name: string) => string | undefined;
}): Promise<ResolvedSubmitter | null> {
	const tradeToken = cookies.get('trade_session');
	if (tradeToken) {
		const session = await getTradeSession(tradeToken).catch(() => null);
		if (session && new Date(session.expires_at) > new Date()) {
			return { kind: 'trade', id: session.trade_partner_id };
		}
	}
	const portalToken = cookies.get('portal_session');
	if (portalToken) {
		const session = await getSession(portalToken).catch(() => null);
		if (session && new Date(session.expires_at) > new Date()) {
			return { kind: 'client', id: session.client.id };
		}
	}
	return null;
}

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
	const submitter = await resolveSubmitter(cookies);
	if (!submitter) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const filename = String(body?.filename || '').trim();
	const mimeType = String(body?.mimeType || 'application/octet-stream').trim();

	if (!filename) return json({ error: 'filename required' }, { status: 400 });

	const rawExt = filename.split('.').pop()?.toLowerCase() || '';
	const ext = rawExt || (mimeType.startsWith('video/') ? 'mp4' : 'jpg');

	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 8);
	const prefix = submitter.kind === 'client' ? `clients/${submitter.id}` : submitter.id;
	const storagePath = `${prefix}/${timestamp}-${random}.${ext}`;

	const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath);

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
