import { json } from '@sveltejs/kit';
import { requireDesigner } from '$lib/server/designer';
import {
	CONVERT_ERROR_MESSAGES,
	CONVERT_ERROR_STATUS,
	ConversionError,
	contentDispositionFor,
	converterHealth,
	convertDwgToDxf,
	dxfVersion,
	maxUploadBytes,
	newJobId
} from '$lib/server/cad-convert';
import { createLogger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = createLogger('api.designer.cad-convert');

function failure(code: keyof typeof CONVERT_ERROR_MESSAGES, jobId: string) {
	return json(
		{ message: CONVERT_ERROR_MESSAGES[code], code, jobId },
		{ status: CONVERT_ERROR_STATUS[code] }
	);
}

/** Health probe: is the CAD converter binary present and runnable? */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const health = await converterHealth();
	return json({
		status: health.available ? 'ok' : 'unavailable',
		converter: health.available ? 'available' : 'unavailable',
		version: health.version,
		configured: health.configured,
		detail: health.detail,
		dxfVersion: dxfVersion(),
		maxUploadMb: Math.round(maxUploadBytes() / (1024 * 1024))
	});
};

export const POST: RequestHandler = async ({ cookies, request }) => {
	const auth = await requireDesigner(cookies);
	if (!auth.ok) return auth.response;

	const jobId = newJobId();
	const limit = maxUploadBytes();

	// Reject oversized uploads before buffering the body.
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > limit) {
		return failure('too_large', jobId);
	}

	let file: File | null = null;
	try {
		const form = await request.formData();
		const entry = form.get('file');
		if (entry instanceof File) file = entry;
	} catch (err) {
		log.error('formData parse failed', {
			jobId,
			error: err instanceof Error ? err.message : String(err)
		});
		return failure('server_error', jobId);
	}

	if (!file) return failure('invalid_extension', jobId);
	if (file.size > limit) return failure('too_large', jobId);
	if (file.size === 0) return failure('empty_file', jobId);

	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const result = await convertDwgToDxf({ bytes, fileName: file.name, jobId });

		return new Response(result.dxf, {
			status: 200,
			headers: {
				'Content-Type': 'application/dxf',
				'Content-Length': String(result.dxf.byteLength),
				'Content-Disposition': contentDispositionFor(result.baseName),
				'Cache-Control': 'no-store',
				'X-Job-Id': result.jobId
			}
		});
	} catch (err) {
		if (err instanceof ConversionError) {
			return json(
				{ message: err.userMessage, code: err.code, jobId: err.jobId },
				{ status: err.status }
			);
		}
		log.error('unhandled conversion error', {
			jobId,
			error: err instanceof Error ? err.message : String(err)
		});
		return failure('server_error', jobId);
	}
};
