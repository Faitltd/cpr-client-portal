import { json } from '@sveltejs/kit';
import { supabase, getTradeSession, getSession } from '$lib/server/db';
import { shouldNormalize, normalizeImage } from '$lib/server/image-normalizer';
import type { RequestHandler } from './$types';

const MAX_IMAGE_SIZE = 25 * 1024 * 1024;  // 25MB pre-normalization (handles big HEIC/4K)
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_FILES = 5;
const BUCKET = 'trade-photos';

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv', 'hevc']);

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

export const POST: RequestHandler = async ({ cookies, request }) => {
	const submitter = await resolveSubmitter(cookies);
	if (!submitter) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const formData = await request.formData();
		const files = formData.getAll('files') as File[];

		if (!files.length) {
			return json({ error: 'No files provided' }, { status: 400 });
		}

		if (files.length > MAX_FILES) {
			return json({ error: `Maximum ${MAX_FILES} files allowed` }, { status: 400 });
		}

		const uploaded: { id: string; url: string; name: string }[] = [];
		const prefix = submitter.kind === 'client' ? `clients/${submitter.id}` : submitter.id;

		for (const file of files) {
			if (!(file instanceof File)) {
				return json({ error: 'Invalid file upload' }, { status: 400 });
			}

			const rawExt = file.name.split('.').pop()?.toLowerCase() || '';
			const ext = rawExt || (file.type.startsWith('video/') ? 'mp4' : 'jpg');
			const isVideo = file.type.startsWith('video/') || VIDEO_EXTS.has(rawExt);

			if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !VIDEO_EXTS.has(ext)) {
				return json({ error: `File "${file.name}" is not a supported image or video` }, { status: 400 });
			}

			const sizeLimit = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
			const sizeLabelMB = isVideo ? '200' : '10';
			if (file.size > sizeLimit) {
				return json(
					{ error: `File "${file.name}" exceeds ${sizeLabelMB}MB limit` },
					{ status: 400 }
				);
			}

			const timestamp = Date.now();
			const random = Math.random().toString(36).slice(2, 8);

			let storagePath = `${prefix}/${timestamp}-${random}.${ext}`;
			let uploadBuffer: Buffer | ArrayBuffer = await file.arrayBuffer();
			let uploadContentType = file.type;
			let thumbPath: string | null = null;

			// Normalize images: HEIC → JPEG, resize 4K → 2048, re-encode at
			// quality 82, generate a thumbnail. Video files and animated GIFs
			// pass through untouched.
			if (!isVideo && shouldNormalize({ type: file.type, name: file.name, size: file.size })) {
				try {
					const input = Buffer.from(uploadBuffer);
					const norm = await normalizeImage(input, file.name);
					uploadBuffer = norm.full;
					uploadContentType = norm.contentType;
					storagePath = `${prefix}/${timestamp}-${random}.${norm.ext}`;
					thumbPath = `${prefix}/${timestamp}-${random}-thumb.${norm.ext}`;
					console.log(
						`[photo-upload] normalized ${file.name}: ${norm.originalBytes} → ${norm.normalizedBytes} bytes (${norm.width}x${norm.height})`
					);
					// Upload the thumbnail in parallel with the main image.
					const { error: thumbErr } = await supabase.storage
						.from(BUCKET)
						.upload(thumbPath, norm.thumb, {
							contentType: norm.contentType,
							upsert: false
						});
					if (thumbErr) {
						console.warn('[photo-upload] thumbnail upload failed:', thumbErr.message);
						thumbPath = null;
					}
				} catch (err) {
					console.warn(
						'[photo-upload] normalization failed, storing original:',
						err instanceof Error ? err.message : err
					);
					// Fall through with the original buffer.
				}
			}

			const { error: uploadError } = await supabase.storage
				.from(BUCKET)
				.upload(storagePath, uploadBuffer, {
					contentType: uploadContentType,
					upsert: false
				});

			if (uploadError) {
				console.error('Supabase upload error:', uploadError);
				return json(
					{ error: `Upload failed: ${uploadError.message}` },
					{ status: 500 }
				);
			}

			uploaded.push({
				id: storagePath,
				url: `/api/trade/photos/storage/${storagePath}`,
				name: file.name,
				...(thumbPath
					? { thumbnailUrl: `/api/trade/photos/storage/${thumbPath}` }
					: {})
			});
		}

		return json({ data: uploaded }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Photo upload failed:', message);
		return json({ error: message || 'Photo upload failed' }, { status: 500 });
	}
};
