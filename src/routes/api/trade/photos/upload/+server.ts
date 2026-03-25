import { json } from '@sveltejs/kit';
import { supabase } from '$lib/server/db';
import { getTradeSession } from '$lib/server/db';
import type { RequestHandler } from './$types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const BUCKET = 'trade-photos';

export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const session = await getTradeSession(token);
		if (!session || new Date(session.expires_at) < new Date()) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const formData = await request.formData();
		const files = formData.getAll('files') as File[];

		if (!files.length) {
			return json({ error: 'No files provided' }, { status: 400 });
		}

		if (files.length > MAX_FILES) {
			return json({ error: `Maximum ${MAX_FILES} files allowed` }, { status: 400 });
		}

		const uploaded: { id: string; url: string; name: string }[] = [];

		for (const file of files) {
			if (!(file instanceof File)) {
				return json({ error: 'Invalid file upload' }, { status: 400 });
			}

			if (!file.type.startsWith('image/')) {
				return json({ error: `File "${file.name}" is not an image` }, { status: 400 });
			}

			if (file.size > MAX_FILE_SIZE) {
				return json(
					{ error: `File "${file.name}" exceeds 10MB limit` },
					{ status: 400 }
				);
			}

			const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
			const timestamp = Date.now();
			const random = Math.random().toString(36).slice(2, 8);
			const storagePath = `${session.trade_partner_id}/${timestamp}-${random}.${ext}`;

			const arrayBuffer = await file.arrayBuffer();
			const { error: uploadError } = await supabase.storage
				.from(BUCKET)
				.upload(storagePath, arrayBuffer, {
					contentType: file.type,
					upsert: false
				});

			if (uploadError) {
				console.error('Supabase upload error:', uploadError);
				return json(
					{ error: `Upload failed: ${uploadError.message}` },
					{ status: 500 }
				);
			}

			const { data: urlData } = supabase.storage
				.from(BUCKET)
				.getPublicUrl(storagePath);

			uploaded.push({
				id: storagePath,
				url: urlData.publicUrl,
				name: file.name
			});
		}

		return json({ data: uploaded }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Photo upload failed:', message);
		return json({ error: message || 'Photo upload failed' }, { status: 500 });
	}
};
