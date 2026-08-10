/**
 * ProKitchen DWG → Chief Architect DXF conversion.
 *
 * Wraps GNU LibreDWG's `dwg2dxf` binary (compiled into the container image;
 * see the `libredwg` stage in the Dockerfile). Everything runs in a throwaway
 * temp directory that is removed whether the conversion succeeds or fails —
 * client drawings are never persisted.
 */

import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const log = createLogger('cad-convert');
const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** DXF targets `dwg2dxf` accepts. R2018 is the production default. */
export const SUPPORTED_DXF_VERSIONS = [
	'r12',
	'r14',
	'r2000',
	'r2004',
	'r2007',
	'r2010',
	'r2013',
	'r2018'
] as const;

export type DxfVersion = (typeof SUPPORTED_DXF_VERSIONS)[number];

const DEFAULT_DXF_VERSION: DxfVersion = 'r2018';

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

function converterPath(): string {
	const raw = (env.DWG2DXF_PATH ?? '').trim();
	return raw || 'dwg2dxf';
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
	converter_missing: 'The converter is not available right now. Please tell Ray.',
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

type ExecError = Error & {
	code?: number | string;
	killed?: boolean;
	signal?: string | null;
	stderr?: string;
	stdout?: string;
};

/**
 * Convert DWG bytes to DXF. Throws `ConversionError` for every failure path.
 * The temp directory is always removed.
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

	const version = dxfVersion();
	const timeout = conversionTimeoutMs();
	const startedAt = Date.now();

	// Random isolated directory — the uploaded name never touches a path.
	const dir = join(tmpdir(), 'cad-converter', randomUUID());
	const inputPath = join(dir, 'input.dwg');
	const outputPath = join(dir, 'output.dxf');

	log.info('conversion started', {
		jobId,
		uploadBytes: input.bytes.byteLength,
		dwgVersion: dwgVersionMarker(head),
		dxfVersion: version
	});

	try {
		await mkdir(dir, { recursive: true, mode: 0o700 });
		await writeFile(inputPath, input.bytes, { mode: 0o600 });

		try {
			// Argument array, never a shell string.
			await run(converterPath(), ['--as', version, '-y', '-o', outputPath, inputPath], {
				timeout,
				killSignal: 'SIGKILL',
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true
			});
		} catch (err) {
			const execErr = err as ExecError;
			const timedOut = Boolean(execErr.killed) || execErr.signal === 'SIGKILL';
			const missing = execErr.code === 'ENOENT';
			log.error('dwg2dxf failed', {
				jobId,
				exitCode: typeof execErr.code === 'number' ? execErr.code : null,
				signal: execErr.signal ?? null,
				timedOut,
				durationMs: Date.now() - startedAt,
				stderr: (execErr.stderr ?? '').slice(0, 2000)
			});
			if (missing) throw new ConversionError('converter_missing', jobId);
			if (timedOut) throw new ConversionError('timeout', jobId);
			throw new ConversionError('conversion_failed', jobId);
		}

		// Exit code 0 does not guarantee a usable file.
		let outputSize = 0;
		try {
			outputSize = (await stat(outputPath)).size;
		} catch {
			outputSize = 0;
		}
		if (outputSize <= 0) {
			log.error('dwg2dxf produced no output', { jobId, durationMs: Date.now() - startedAt });
			throw new ConversionError('conversion_failed', jobId);
		}

		const dxf = await readFile(outputPath);
		const durationMs = Date.now() - startedAt;
		log.info('conversion succeeded', { jobId, outputBytes: dxf.byteLength, durationMs });
		return { dxf, baseName, jobId, durationMs };
	} catch (err) {
		if (err instanceof ConversionError) throw err;
		log.error('conversion errored', {
			jobId,
			error: err instanceof Error ? err.message : String(err)
		});
		throw new ConversionError('server_error', jobId);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch((err) => {
			log.warn('temp cleanup failed', {
				jobId,
				error: err instanceof Error ? err.message : String(err)
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ConverterHealth = {
	available: boolean;
	version: string | null;
};

/** Confirms `dwg2dxf` exists and runs. Version string is logged, not exposed. */
export async function converterHealth(): Promise<ConverterHealth> {
	try {
		const { stdout, stderr } = await run(converterPath(), ['--version'], {
			timeout: 5000,
			maxBuffer: 256 * 1024,
			windowsHide: true
		});
		const line = `${stdout}${stderr}`.split('\n').find((l) => l.trim().length > 0);
		return { available: true, version: line ? line.trim().slice(0, 120) : null };
	} catch (err) {
		log.error('converter health check failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return { available: false, version: null };
	}
}
