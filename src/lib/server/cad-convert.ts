/**
 * ProKitchen DWG → Chief Architect DXF conversion.
 *
 * The portal runs on Render's Node runtime, which cannot execute a Dockerfile,
 * so the LibreDWG binary lives in a separate Docker service (see `converter/`).
 * This module holds the designer-facing rules — validation, filenames, error
 * copy, job IDs — and forwards the bytes to that service over a shared token.
 * Neither side stores anything.
 */

import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const log = createLogger('cad-convert');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * DXF targets `dwg2dxf` actually accepts in LibreDWG 0.13.3 (the pinned build).
 * Its `--help` lists r2018 under "Planned versions", not valid ones —
 * `--as r2018` is rejected as an invalid version and exits 1. R2013 is the
 * newest real target, and Chief Architect X17 imports AutoCAD 2025 and earlier,
 * so R2013 is comfortably within range.
 */
export const SUPPORTED_DXF_VERSIONS = [
	'r12',
	'r14',
	'r2000',
	'r2004',
	'r2007',
	'r2010',
	'r2013'
] as const;

export type DxfVersion = (typeof SUPPORTED_DXF_VERSIONS)[number];

const DEFAULT_DXF_VERSION: DxfVersion = 'r2013';

export function dxfVersion(): DxfVersion {
	const raw = (env.DXF_VERSION ?? '').trim().toLowerCase();
	if (!raw) return DEFAULT_DXF_VERSION;
	if ((SUPPORTED_DXF_VERSIONS as readonly string[]).includes(raw)) return raw as DxfVersion;
	log.warn('Unsupported DXF_VERSION, falling back', { requested: raw, using: DEFAULT_DXF_VERSION });
	return DEFAULT_DXF_VERSION;
}

export function maxUploadBytes(): number {
	const parsed = Number(env.MAX_UPLOAD_MB);
	const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
	return Math.floor(mb * 1024 * 1024);
}

export function conversionTimeoutMs(): number {
	const parsed = Number(env.CONVERSION_TIMEOUT_SECONDS);
	const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
	return Math.floor(seconds * 1000);
}

/** Base URL of the converter service, e.g. https://cpr-cad-converter.onrender.com */
export function converterBaseUrl(): string {
	return (env.CAD_CONVERTER_URL ?? '').trim().replace(/\/+$/, '');
}

function converterToken(): string {
	return (env.CAD_CONVERTER_TOKEN ?? '').trim();
}

export function converterConfigured(): boolean {
	return Boolean(converterBaseUrl() && converterToken());
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ConvertErrorCode =
	| 'invalid_extension'
	| 'empty_file'
	| 'too_large'
	| 'invalid_dwg'
	| 'conversion_failed'
	| 'timeout'
	| 'converter_missing'
	| 'server_error';

/** Designer-facing copy. Raw LibreDWG / Node output never reaches the browser. */
export const CONVERT_ERROR_MESSAGES: Record<ConvertErrorCode, string> = {
	invalid_extension: 'Please upload a DWG file exported from ProKitchen.',
	empty_file: 'That file is empty. Try exporting the design from ProKitchen again.',
	too_large: 'This DWG exceeds the 25 MB upload limit.',
	invalid_dwg:
		'This file could not be read as a valid DWG. Try exporting the design from ProKitchen again.',
	conversion_failed:
		'The drawing could not be converted. The DWG may contain objects that the converter does not support.',
	timeout: 'The drawing took too long to process. Try exporting a simpler DWG from ProKitchen.',
	converter_missing:
		'The converter is offline — nothing is wrong with your file. This is a server setup issue.',
	server_error: 'The converter encountered an unexpected error. No file was saved.'
};

export const CONVERT_ERROR_STATUS: Record<ConvertErrorCode, number> = {
	invalid_extension: 400,
	empty_file: 400,
	too_large: 413,
	invalid_dwg: 422,
	conversion_failed: 422,
	timeout: 504,
	converter_missing: 503,
	server_error: 500
};

export class ConversionError extends Error {
	code: ConvertErrorCode;
	jobId: string;

	constructor(code: ConvertErrorCode, jobId: string, detail?: string) {
		super(detail ?? code);
		this.name = 'ConversionError';
		this.code = code;
		this.jobId = jobId;
	}

	/** Copy safe to show a designer. */
	get userMessage(): string {
		return CONVERT_ERROR_MESSAGES[this.code];
	}

	get status(): number {
		return CONVERT_ERROR_STATUS[this.code];
	}
}

// ---------------------------------------------------------------------------
// Job IDs
// ---------------------------------------------------------------------------

/** Short, human-quotable reference shown on failure, e.g. `CAD-7F39A21C`. */
export function newJobId(): string {
	return `CAD-${randomBytes(4).toString('hex').toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Filename handling
// ---------------------------------------------------------------------------

/**
 * Reduce an uploaded filename to a safe download basename (no extension).
 * The result is only ever used to name the *response*, never a filesystem path.
 */
export function sanitizeBaseName(rawName: string): string {
	const withoutPath = String(rawName ?? '')
		.split(/[\\/]/)
		.pop();
	const base = (withoutPath ?? '').replace(/\.dwg$/i, '');
	const cleaned = base
		// Strip control chars, path separators, and characters that break
		// Content-Disposition or Windows filenames.
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
		.replace(/^[.\s]+/, '')
		.replace(/[.\s]+$/, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return cleaned.slice(0, 120) || 'drawing';
}

/** RFC 5987 header so Unicode filenames survive the round trip. */
export function contentDispositionFor(baseName: string): string {
	const fileName = `${baseName}.dxf`;
	// eslint-disable-next-line no-control-regex
	const ascii = fileName.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function hasDwgExtension(fileName: string): boolean {
	return /\.dwg$/i.test(String(fileName ?? '').trim());
}

/**
 * DWG files open with a 6-byte ASCII version marker (`AC1015`, `AC1032`, …).
 * Checking it rejects executables and PDFs renamed to `.dwg` before the file
 * ever reaches LibreDWG.
 */
export function looksLikeDwg(head: Uint8Array): boolean {
	if (!head || head.length < 6) return false;
	const marker = Buffer.from(head.subarray(0, 6)).toString('latin1');
	return /^AC(10\d{2}|1\.\d{2}|2\.\d{2})$/.test(marker);
}

/** The DWG version marker, for logs only. */
export function dwgVersionMarker(head: Uint8Array): string | null {
	if (!head || head.length < 6) return null;
	const marker = Buffer.from(head.subarray(0, 6)).toString('latin1');
	return /^[\x20-\x7e]{6}$/.test(marker) ? marker : null;
}

/**
 * Cheap checks that need no disk access. Returns an error code or null.
 */
export function validateUpload(input: {
	fileName: string;
	size: number;
	head: Uint8Array;
}): ConvertErrorCode | null {
	if (!hasDwgExtension(input.fileName)) return 'invalid_extension';
	if (!Number.isFinite(input.size) || input.size <= 0) return 'empty_file';
	if (input.size > maxUploadBytes()) return 'too_large';
	if (!looksLikeDwg(input.head)) return 'invalid_dwg';
	return null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export type ConversionResult = {
	dxf: Buffer;
	baseName: string;
	jobId: string;
	durationMs: number;
};

/** Error codes the converter service is allowed to hand back. */
const REMOTE_CODES = new Set<ConvertErrorCode>([
	'invalid_extension',
	'empty_file',
	'too_large',
	'invalid_dwg',
	'conversion_failed',
	'timeout',
	'server_error'
]);

function remoteCode(value: unknown): ConvertErrorCode | null {
	return typeof value === 'string' && REMOTE_CODES.has(value as ConvertErrorCode)
		? (value as ConvertErrorCode)
		: null;
}

/**
 * Convert DWG bytes to DXF via the converter service.
 * Throws `ConversionError` for every failure path.
 */
export async function convertDwgToDxf(input: {
	bytes: Uint8Array;
	fileName: string;
	jobId?: string;
}): Promise<ConversionResult> {
	const jobId = input.jobId ?? newJobId();
	const baseName = sanitizeBaseName(input.fileName);
	const head = input.bytes.subarray(0, 6);

	const invalid = validateUpload({
		fileName: input.fileName,
		size: input.bytes.byteLength,
		head
	});
	if (invalid) throw new ConversionError(invalid, jobId);

	if (!converterConfigured()) {
		log.error('converter not configured', {
			jobId,
			hasUrl: Boolean(converterBaseUrl()),
			hasToken: Boolean(env.CAD_CONVERTER_TOKEN)
		});
		throw new ConversionError('converter_missing', jobId);
	}

	const startedAt = Date.now();
	log.info('conversion started', {
		jobId,
		uploadBytes: input.bytes.byteLength,
		dwgVersion: dwgVersionMarker(head)
	});

	// Allow the converter to hit its own timeout first so its error wins.
	const deadline = conversionTimeoutMs() + 15000;

	// Blob needs an ArrayBuffer-backed view; this constructor copies into one.
	const body = new Uint8Array(input.bytes);
	const form = new FormData();
	form.append('file', new Blob([body.buffer]), `${baseName}.dwg`);

	let response: Response;
	try {
		response = await fetch(`${converterBaseUrl()}/convert`, {
			method: 'POST',
			headers: {
				'X-Converter-Token': env.CAD_CONVERTER_TOKEN?.trim() ?? '',
				'X-Job-Id': jobId
			},
			body: form,
			signal: AbortSignal.timeout(deadline)
		});
	} catch (err) {
		const aborted = err instanceof Error && err.name === 'TimeoutError';
		log.error('converter request failed', {
			jobId,
			aborted,
			durationMs: Date.now() - startedAt,
			error: err instanceof Error ? err.message : String(err)
		});
		throw new ConversionError(aborted ? 'timeout' : 'converter_missing', jobId);
	}

	if (!response.ok) {
		let code: ConvertErrorCode | null = null;
		try {
			const payload = await response.json();
			code = remoteCode(payload?.code);
		} catch {
			/* non-JSON error body */
		}
		log.error('converter returned an error', {
			jobId,
			status: response.status,
			code,
			durationMs: Date.now() - startedAt
		});
		// 401/503 mean the service is misconfigured or asleep, not a bad drawing.
		if (!code) {
			throw new ConversionError(
				response.status === 401 || response.status === 503 ? 'converter_missing' : 'server_error',
				jobId
			);
		}
		throw new ConversionError(code, jobId);
	}

	const dxf = Buffer.from(await response.arrayBuffer());
	if (dxf.byteLength === 0) {
		log.error('converter returned an empty body', { jobId });
		throw new ConversionError('conversion_failed', jobId);
	}

	const durationMs = Date.now() - startedAt;
	log.info('conversion succeeded', { jobId, outputBytes: dxf.byteLength, durationMs });
	return { dxf, baseName, jobId, durationMs };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ConverterHealth = {
	available: boolean;
	version: string | null;
	/** Why the probe failed, so a bad deploy can be diagnosed without shell access. */
	detail: string | null;
	/** Whether the portal has both the URL and the token. */
	configured: boolean;
};

/** Asks the converter service whether it can run dwg2dxf. */
export async function converterHealth(): Promise<ConverterHealth> {
	const configured = converterConfigured();
	if (!configured) {
		const detail = `CAD_CONVERTER_URL ${converterBaseUrl() ? 'set' : 'missing'}, CAD_CONVERTER_TOKEN ${
			env.CAD_CONVERTER_TOKEN?.trim() ? 'set' : 'missing'
		}`;
		log.error('converter not configured', { detail });
		return { available: false, version: null, detail, configured };
	}

	try {
		const response = await fetch(`${converterBaseUrl()}/health`, {
			signal: AbortSignal.timeout(20000)
		});
		const payload = (await response.json()) as {
			converter?: string;
			version?: string | null;
		};
		const available = response.ok && payload?.converter === 'available';
		return {
			available,
			version: payload?.version ?? null,
			detail: available ? null : `converter responded ${response.status}`,
			configured
		};
	} catch (err) {
		// A sleeping free-tier instance can exceed the probe timeout on first hit.
		const detail = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : String(err);
		log.error('converter health check failed', { detail });
		return { available: false, version: null, detail, configured };
	}
}
