/**
 * Background transcoding worker
 *
 * Runs as a standalone Node.js process (no SvelteKit).
 * Polls the `transcoding_jobs` Supabase table, downloads video files,
 * transcodes HEVC/MOV → H.264 MP4 via FFmpeg, uploads the result back to
 * Supabase storage, and attaches it to the Zoho CRM Field_Updates record.
 *
 * Render Background Worker start command: node worker/transcode.js
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { createWriteStream, openAsBlob } from 'fs';
import { unlink, mkdir, stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config — all from process.env (no SvelteKit $env)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZOHO_TOKEN_URL = process.env.ZOHO_TOKEN_URL || 'https://accounts.zoho.com/oauth/v2/token';
const ZOHO_API_BASE = process.env.ZOHO_API_BASE || 'https://www.zohoapis.com/crm/v8';
const BUCKET = 'trade-photos';
const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const ZOHO_ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB

// Hard guards against OOM on the worker. Inputs above either cap are marked
// `failed` immediately and never reach FFmpeg.
const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES || 200 * 1024 * 1024); // 200 MB
const MAX_INPUT_PIXELS = 8_300_000; // 3840 * 2160 ≈ 4K

// Anything stuck in `processing` longer than this is presumed dead (typically
// an OOM kill) and gets swept back to `pending`, or to `failed` if it has
// already exhausted MAX_ATTEMPTS.
const STALE_JOB_MS = 10 * 60 * 1000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error('[worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — exiting');
	process.exit(1);
}

// Node 20 doesn't have native WebSocket; Supabase's realtime client crashes
// at construction without one. Provide `ws` so the worker can boot. We don't
// actually subscribe to realtime, but the client requires the transport regardless.
import ws from 'ws';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false },
	realtime: { transport: ws }
});

// Marker for "this job will never succeed — don't retry."
class JobRejection extends Error {
	constructor(message) {
		super(message);
		this.name = 'JobRejection';
	}
}

// ---------------------------------------------------------------------------
// FFmpeg / FFprobe
// ---------------------------------------------------------------------------

/**
 * Probe duration + dimensions + codec from the input file.
 * Returns null fields if anything can't be determined.
 */
function probeMedia(inputPath) {
	return new Promise((resolve) => {
		const proc = spawn('ffprobe', [
			'-v', 'quiet',
			'-print_format', 'json',
			'-show_format',
			'-show_streams',
			inputPath
		], { stdio: ['ignore', 'pipe', 'ignore'] });
		const out = [];
		proc.stdout.on('data', (d) => out.push(d));
		proc.on('close', () => {
			try {
				const json = JSON.parse(Buffer.concat(out).toString());
				const duration = parseFloat(json?.format?.duration);
				const v = (json?.streams || []).find((s) => s.codec_type === 'video');
				resolve({
					duration: isNaN(duration) ? null : duration,
					width: v?.width ?? null,
					height: v?.height ?? null,
					codec: v?.codec_name ?? null
				});
			} catch {
				resolve({ duration: null, width: null, height: null, codec: null });
			}
		});
		proc.on('error', () => resolve({ duration: null, width: null, height: null, codec: null }));
	});
}

function transcodeToMp4(inputPath, outputPath, durationSecs) {
	return new Promise((resolve, reject) => {
		// Target just under 18MB to stay safely within Zoho's 20MB limit.
		// Calculate bitrate from duration; fall back to 800k if unknown.
		const TARGET_BYTES = 18 * 1024 * 1024;
		const AUDIO_KBPS = 96;
		let videoBitrateKbps = 800;
		if (durationSecs && durationSecs > 0) {
			const totalKbps = (TARGET_BYTES * 8) / durationSecs / 1000;
			videoBitrateKbps = Math.max(200, Math.round(totalKbps - AUDIO_KBPS));
		}

		// Memory-bounded encode for a small Render instance. `-threads 1`
		// appears twice on purpose: before `-i` it caps the HEVC decoder's
		// DPB replication, after `-i` it caps libx264's frame parallelism.
		// Locally this took 4K HEVC → 1080p H.264 from ~1.05 GB peak RSS
		// down to ~390 MB. The `-x264-params` line ensures x264 doesn't
		// sneak threads back in via sliced/lookahead workers, and trims
		// rc-lookahead from the 40-frame default to 10 frames.
		const args = [
			'-threads', '1',
			'-i', inputPath,
			'-vf', "scale='min(1920,iw)':-2",
			'-pix_fmt', 'yuv420p',
			'-c:v', 'libx264',
			'-preset', 'fast',
			'-threads', '1',
			'-x264-params', 'threads=1:lookahead_threads=1:sliced_threads=0:rc-lookahead=10',
			'-b:v', `${videoBitrateKbps}k`,
			'-maxrate', `${videoBitrateKbps * 2}k`,
			'-bufsize', `${videoBitrateKbps * 4}k`,
			'-c:a', 'aac',
			'-b:a', `${AUDIO_KBPS}k`,
			'-movflags', '+faststart',
			'-y',
			outputPath
		];
		const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const stderr = [];
		proc.stderr.on('data', (d) => stderr.push(d));
		proc.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`FFmpeg exited ${code}: ${Buffer.concat(stderr).toString().slice(-400)}`));
		});
		proc.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
	});
}

// ---------------------------------------------------------------------------
// Zoho helpers
// ---------------------------------------------------------------------------

async function getZohoAccessToken() {
	const { data, error } = await supabase
		.from('zoho_tokens')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	if (error || !data) throw new Error('No Zoho tokens found in database');

	if (new Date(data.expires_at) > new Date()) {
		return { accessToken: data.access_token, apiDomain: data.api_domain };
	}

	// Refresh
	const params = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: process.env.ZOHO_CLIENT_ID || '',
		client_secret: process.env.ZOHO_CLIENT_SECRET || '',
		refresh_token: data.refresh_token
	});

	const res = await fetch(ZOHO_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params
	});

	if (!res.ok) throw new Error(`Zoho token refresh failed: ${await res.text()}`);
	const refreshed = await res.json();

	const expiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
	await supabase.from('zoho_tokens').update({
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token || data.refresh_token,
		expires_at: expiresAt
	}).eq('id', data.id);

	return { accessToken: refreshed.access_token, apiDomain: data.api_domain };
}

function getApiBase(apiDomain) {
	if (!apiDomain) return ZOHO_API_BASE;
	const domain = apiDomain.replace(/\/$/, '');
	try {
		const envUrl = new URL(ZOHO_API_BASE);
		const path = envUrl.pathname.replace(/\/$/, '') || '/crm/v8';
		return `${domain}${path}`;
	} catch {
		return `${domain}/crm/v8`;
	}
}

async function uploadToZoho(accessToken, apiDomain, module, recordId, blob, fileName) {
	if (blob.size > ZOHO_ATTACHMENT_SIZE_LIMIT) {
		console.info(`[worker] Skipping Zoho upload for ${fileName} — ${(blob.size / 1024 / 1024).toFixed(1)}MB exceeds 20MB limit`);
		return;
	}

	const base = getApiBase(apiDomain);
	const url = `${base}/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}/Attachments`;
	const form = new FormData();
	form.append('file', blob, fileName);

	const res = await fetch(url, {
		method: 'POST',
		headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
		body: form,
		signal: AbortSignal.timeout(60_000)
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Zoho attachment upload failed (${res.status}): ${text}`);
	}
	console.info(`[worker] Attached ${fileName} to Zoho ${module}/${recordId}`);
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------

async function sweepStaleJobs() {
	const cutoff = new Date(Date.now() - STALE_JOB_MS).toISOString();
	const { data: stale } = await supabase
		.from('transcoding_jobs')
		.select('id, attempts')
		.eq('status', 'processing')
		.lt('updated_at', cutoff);

	if (!stale?.length) return;

	for (const row of stale) {
		const isFinal = (row.attempts ?? 0) >= MAX_ATTEMPTS;
		await supabase.from('transcoding_jobs').update({
			status: isFinal ? 'failed' : 'pending',
			error: isFinal ? 'Worker died mid-job (likely OOM); attempts exhausted' : null,
			updated_at: new Date().toISOString()
		}).eq('id', row.id);
		console.warn(`[worker] Swept stale job ${row.id} — ${isFinal ? 'marked failed' : 'requeued'}`);
	}
}

async function claimNextJob() {
	// Find the oldest pending job under the attempt limit
	const { data: rows } = await supabase
		.from('transcoding_jobs')
		.select('*')
		.eq('status', 'pending')
		.lt('attempts', MAX_ATTEMPTS)
		.order('created_at')
		.limit(1);

	const job = rows?.[0];
	if (!job) return null;

	// Mark as processing and increment attempts
	const { data: claimed, error } = await supabase
		.from('transcoding_jobs')
		.update({
			status: 'processing',
			attempts: job.attempts + 1,
			updated_at: new Date().toISOString()
		})
		.eq('id', job.id)
		.eq('status', 'pending') // guard against double-claim
		.select()
		.single();

	if (error || !claimed) return null;
	return claimed;
}

async function processJob(job) {
	console.info(`[worker] Processing job ${job.id}: ${job.original_path}`);

	const tmpDir = join(tmpdir(), `transcode_${job.id}`);
	await mkdir(tmpDir, { recursive: true });
	const ext = job.original_path.split('.').pop()?.toLowerCase() || 'mov';
	const inputFile = join(tmpDir, `input.${ext}`);
	const outputFile = join(tmpDir, 'output.mp4');

	try {
		// 1. Download original from Supabase, streamed to disk to avoid
		//    materializing the full file in the JS heap.
		const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(job.original_path);
		if (dlErr || !blob) throw new Error(`Download failed: ${dlErr?.message}`);
		if (blob.size > MAX_INPUT_BYTES) {
			throw new JobRejection(
				`Input file too large: ${(blob.size / 1024 / 1024).toFixed(1)}MB exceeds ${(MAX_INPUT_BYTES / 1024 / 1024).toFixed(0)}MB cap`
			);
		}
		await pipeline(Readable.fromWeb(blob.stream()), createWriteStream(inputFile));
		console.info(`[worker] Downloaded ${job.original_path} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);

		// 2. Probe — reject inputs above the resolution cap before paying
		//    the transcode cost.
		const { duration, width, height, codec } = await probeMedia(inputFile);
		console.info(`[worker] Probed: ${width ?? '?'}x${height ?? '?'} ${codec ?? '?'} ${duration ? duration.toFixed(1) + 's' : 'unknown duration'}`);
		if (width && height && width * height > MAX_INPUT_PIXELS) {
			throw new JobRejection(
				`Input resolution ${width}x${height} exceeds 4K cap (${MAX_INPUT_PIXELS.toLocaleString()} pixels). Re-encode at source before upload.`
			);
		}

		// 3. Transcode
		console.info('[worker] Transcoding...');
		await transcodeToMp4(inputFile, outputFile, duration);

		// 4. Wrap the output file in a file-backed Blob — no heap copy, and
		//    the same Blob can be passed to both Supabase and Zoho uploads.
		const outputStat = await stat(outputFile);
		const mp4Blob = await openAsBlob(outputFile, { type: 'video/mp4' });
		console.info(`[worker] Transcoded to H.264 MP4 (${(outputStat.size / 1024 / 1024).toFixed(1)}MB)`);

		// 5. Upload transcoded file to Supabase
		const outputPath = job.original_path.replace(/\.[^.]+$/, '.mp4');
		const { error: upErr } = await supabase.storage.from(BUCKET).upload(outputPath, mp4Blob, {
			contentType: 'video/mp4',
			upsert: true
		});
		if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`);
		console.info(`[worker] Uploaded transcoded file to ${outputPath}`);

		// 6. Upload to Zoho as attachment if we have a record ID
		if (job.zoho_record_id) {
			try {
				const { accessToken, apiDomain } = await getZohoAccessToken();
				const fileName = outputPath.split('/').pop() || 'video.mp4';
				await uploadToZoho(accessToken, apiDomain, job.zoho_module, job.zoho_record_id, mp4Blob, fileName);
			} catch (zohoErr) {
				// Non-fatal — video is in Supabase regardless
				console.warn('[worker] Zoho upload failed (non-fatal):', zohoErr.message);
			}
		}

		// 7. Update field_update to point to transcoded file
		if (job.field_update_id) {
			const { data: fu } = await supabase
				.from('field_updates')
				.select('photo_ids')
				.eq('id', job.field_update_id)
				.single();
			if (fu && Array.isArray(fu.photo_ids)) {
				const updated = fu.photo_ids.map((p) => (p === job.original_path ? outputPath : p));
				await supabase.from('field_updates').update({ photo_ids: updated }).eq('id', job.field_update_id);
			}
		}

		// 8. Mark job done
		await supabase.from('transcoding_jobs').update({
			status: 'done',
			output_path: outputPath,
			error: null,
			updated_at: new Date().toISOString()
		}).eq('id', job.id);

		console.info(`[worker] Job ${job.id} completed`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error ? err.stack : undefined;
		console.error(`[worker] Job ${job.id} failed:`, message);
		if (stack) console.error(stack);

		// JobRejection means the input can never succeed — skip the retry path.
		const isRejection = err instanceof JobRejection;
		let isFinal = isRejection;
		if (!isFinal) {
			const { data: current } = await supabase
				.from('transcoding_jobs')
				.select('attempts')
				.eq('id', job.id)
				.single();
			isFinal = (current?.attempts ?? 0) >= MAX_ATTEMPTS;
		}

		await supabase.from('transcoding_jobs').update({
			status: isFinal ? 'failed' : 'pending',
			error: message,
			updated_at: new Date().toISOString()
		}).eq('id', job.id);
	} finally {
		// Clean up temp files
		await Promise.allSettled([
			unlink(inputFile).catch(() => {}),
			unlink(outputFile).catch(() => {}),
		]);
	}
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

let running = false;

async function poll() {
	if (running) return;
	running = true;
	try {
		await sweepStaleJobs();
		// Claim and process jobs one at a time until queue is empty
		while (true) {
			const job = await claimNextJob();
			if (!job) break;
			await processJob(job);
		}
	} catch (err) {
		console.error('[worker] Poll error:', err);
	} finally {
		running = false;
	}
}

// Last-resort logging — without these, an OOM or unhandled rejection produces
// no application-level error line in the Render logs.
process.on('uncaughtException', (err) => {
	console.error('[worker] uncaughtException:', err?.stack || err);
	process.exit(1);
});
process.on('unhandledRejection', (reason) => {
	console.error('[worker] unhandledRejection:', reason);
	process.exit(1);
});

console.info('[worker] Transcoding worker started — polling every', POLL_INTERVAL_MS / 1000, 's');
poll(); // Run immediately on startup
setInterval(poll, POLL_INTERVAL_MS);
