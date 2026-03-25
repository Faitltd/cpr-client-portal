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
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error('[worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — exiting');
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false }
});

// ---------------------------------------------------------------------------
// FFmpeg transcoding
// ---------------------------------------------------------------------------

/**
 * Probe video duration in seconds using ffprobe.
 * Returns null if it can't be determined.
 */
function probeDuration(inputPath) {
	return new Promise((resolve) => {
		const proc = spawn('ffprobe', [
			'-v', 'quiet',
			'-print_format', 'json',
			'-show_format',
			inputPath
		], { stdio: ['ignore', 'pipe', 'ignore'] });
		const out = [];
		proc.stdout.on('data', (d) => out.push(d));
		proc.on('close', () => {
			try {
				const json = JSON.parse(Buffer.concat(out).toString());
				const dur = parseFloat(json?.format?.duration);
				resolve(isNaN(dur) ? null : dur);
			} catch {
				resolve(null);
			}
		});
		proc.on('error', () => resolve(null));
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

		const args = [
			'-i', inputPath,
			'-c:v', 'libx264',
			'-b:v', `${videoBitrateKbps}k`,
			'-maxrate', `${videoBitrateKbps * 2}k`,
			'-bufsize', `${videoBitrateKbps * 4}k`,
			'-c:a', 'aac',
			'-b:a', `${AUDIO_KBPS}k`,
			'-preset', 'fast',
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

async function uploadToZoho(accessToken, apiDomain, module, recordId, buffer, fileName) {
	if (buffer.byteLength > ZOHO_ATTACHMENT_SIZE_LIMIT) {
		console.info(`[worker] Skipping Zoho upload for ${fileName} — ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds 20MB limit`);
		return;
	}

	const base = getApiBase(apiDomain);
	const url = `${base}/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}/Attachments`;
	const form = new FormData();
	form.append('file', new Blob([buffer], { type: 'video/mp4' }), fileName);

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
		// 1. Download original from Supabase
		const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(job.original_path);
		if (dlErr || !blob) throw new Error(`Download failed: ${dlErr?.message}`);
		await writeFile(inputFile, Buffer.from(await blob.arrayBuffer()));
		console.info(`[worker] Downloaded ${job.original_path} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);

		// 2. Probe duration then transcode
		const duration = await probeDuration(inputFile);
		console.info(`[worker] Duration: ${duration ? duration.toFixed(1) + 's' : 'unknown'} — transcoding...`);
		await transcodeToMp4(inputFile, outputFile, duration);
		console.info(`[worker] Transcoded to H.264 MP4`);

		// 3. Upload transcoded file to Supabase
		const mp4Buffer = await readFile(outputFile);
		const outputPath = job.original_path.replace(/\.[^.]+$/, '.mp4');
		const { error: upErr } = await supabase.storage.from(BUCKET).upload(outputPath, mp4Buffer, {
			contentType: 'video/mp4',
			upsert: true
		});
		if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`);
		console.info(`[worker] Uploaded transcoded file to ${outputPath}`);

		// 4. Upload to Zoho as attachment if we have a record ID
		if (job.zoho_record_id) {
			try {
				const { accessToken, apiDomain } = await getZohoAccessToken();
				const fileName = outputPath.split('/').pop() || 'video.mp4';
				await uploadToZoho(accessToken, apiDomain, job.zoho_module, job.zoho_record_id, mp4Buffer, fileName);
			} catch (zohoErr) {
				// Non-fatal — video is in Supabase regardless
				console.warn(`[worker] Zoho upload failed (non-fatal):`, zohoErr.message);
			}
		}

		// 5. Update field_update to point to transcoded file
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

		// 6. Mark job done
		await supabase.from('transcoding_jobs').update({
			status: 'done',
			output_path: outputPath,
			error: null,
			updated_at: new Date().toISOString()
		}).eq('id', job.id);

		console.info(`[worker] Job ${job.id} completed`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[worker] Job ${job.id} failed:`, message);

		const { data: current } = await supabase
			.from('transcoding_jobs')
			.select('attempts')
			.eq('id', job.id)
			.single();

		const isFinal = (current?.attempts ?? 0) >= MAX_ATTEMPTS;
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

console.info('[worker] Transcoding worker started — polling every', POLL_INTERVAL_MS / 1000, 's');
poll(); // Run immediately on startup
setInterval(poll, POLL_INTERVAL_MS);
