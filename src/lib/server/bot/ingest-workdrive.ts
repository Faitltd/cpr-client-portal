import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import {
	listWorkDriveFolder,
	downloadWorkDriveFile,
	extractWorkDriveFolderId,
	buildDealFolderCandidates,
	findBestFolderByName,
	type WorkDriveItem
} from '$lib/server/workdrive';
import { chunkText, embed } from './embeddings';

const MAX_FILES_PER_DEAL = Number(env.BOT_WORKDRIVE_MAX_FILES ?? '50');
const MAX_FILE_BYTES = Number(env.BOT_WORKDRIVE_MAX_BYTES ?? String(25 * 1024 * 1024));
const MAX_SUBFOLDER_DEPTH = Number(env.BOT_WORKDRIVE_MAX_DEPTH ?? '3');
// Parent folder that contains one subfolder per Deal. Used as a fallback when
// the Deal record has no WorkDrive_Folder_ID / Client_Portal_Folder set.
const WORKDRIVE_PARENT_FOLDER_ID = (env.BOT_WORKDRIVE_PARENT_FOLDER_ID ?? '').trim();

type WdSource = 'workdrive_pdf' | 'workdrive_docx';

export interface FileSyncOutcome {
	file_id: string;
	name: string;
	size: number | null;
	status: 'inserted' | 'skipped' | 'failed';
	reason?: string;
}

export interface WorkDriveSyncResult {
	dealId: string;
	folderId: string | null;
	folderUrl: string | null;
	processed: number;
	inserted: number;
	skipped: number;
	failed: number;
	files: FileSyncOutcome[];
	error?: string;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');
	let accessToken = tokens.access_token;
	let apiDomain: string | undefined = tokens.api_domain ?? undefined;
	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || apiDomain;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			user_email: tokens.user_email ?? null
		});
	}
	return { accessToken, apiDomain };
}

async function fetchDealFolder(
	accessToken: string,
	apiDomain: string | undefined,
	dealId: string
): Promise<{
	folderId: string | null;
	folderUrl: string | null;
	matchedDealName?: string | null;
	matchedFolderName?: string | null;
	source: 'field' | 'url' | 'autodiscover' | 'none';
}> {
	const res = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Deal_Name,Contact_Name,WorkDrive_Folder_ID,External_Link,Client_Portal_Folder`,
		{},
		apiDomain
	);
	const rec = res?.data?.[0] ?? {};

	// Prefer the internal root folder id — it's the WHOLE project (Photos,
	// Designs, Contracts, Client Portal). Client_Portal_Folder is only the
	// client-facing subset and isn't what we want for full bot indexing.
	const directId =
		typeof rec.WorkDrive_Folder_ID === 'string' ? rec.WorkDrive_Folder_ID.trim() : '';
	if (directId) {
		return { folderId: directId, folderUrl: null, source: 'field' };
	}

	// Fall back to URL-based fields, in priority order: External_Link (root
	// share link) → Client_Portal_Folder (client-facing only).
	const url =
		(typeof rec.External_Link === 'string' && rec.External_Link) ||
		(typeof rec.Client_Portal_Folder === 'string' && rec.Client_Portal_Folder) ||
		null;
	const urlFolderId = extractWorkDriveFolderId(url);
	if (urlFolderId) {
		return { folderId: urlFolderId, folderUrl: url, source: 'url' };
	}

	// Final fallback: search the configured parent folder for a subfolder whose
	// name matches the Deal name (or its primary contact's name).
	if (!WORKDRIVE_PARENT_FOLDER_ID) {
		return { folderId: null, folderUrl: url, source: 'none' };
	}

	const dealName = typeof rec.Deal_Name === 'string' ? rec.Deal_Name : '';
	const contactName =
		rec.Contact_Name && typeof rec.Contact_Name === 'object' && 'name' in rec.Contact_Name
			? String((rec.Contact_Name as { name?: unknown }).name ?? '')
			: '';
	const candidates = [
		...buildDealFolderCandidates(dealName),
		...buildDealFolderCandidates(contactName)
	];
	if (candidates.length === 0) {
		return { folderId: null, folderUrl: url, source: 'none' };
	}

	let parentItems: WorkDriveItem[] = [];
	try {
		parentItems = await listWorkDriveFolder(
			accessToken,
			WORKDRIVE_PARENT_FOLDER_ID,
			apiDomain,
			{ perPage: 200, maxPages: 5 }
		);
	} catch (err) {
		console.warn(
			`[bot/ingest-workdrive] autodiscover failed listing parent ${WORKDRIVE_PARENT_FOLDER_ID}:`,
			err instanceof Error ? err.message : err
		);
		return { folderId: null, folderUrl: url, source: 'none' };
	}

	const match = findBestFolderByName(parentItems, candidates);
	if (!match) {
		return {
			folderId: null,
			folderUrl: url,
			matchedDealName: dealName || contactName,
			source: 'none'
		};
	}
	return {
		folderId: match.id,
		folderUrl: null,
		matchedDealName: dealName || contactName,
		matchedFolderName: match.name,
		source: 'autodiscover'
	};
}

function pickSource(name: string, mime: string | null): WdSource | null {
	const lower = name.toLowerCase();
	if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'workdrive_pdf';
	if (
		lower.endsWith('.docx') ||
		mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	) {
		return 'workdrive_docx';
	}
	return null;
}

async function collectIngestibleFiles(
	accessToken: string,
	apiDomain: string | undefined,
	folderId: string,
	depth: number,
	out: { item: WorkDriveItem; source: WdSource }[]
): Promise<void> {
	if (depth > MAX_SUBFOLDER_DEPTH) return;
	if (out.length >= MAX_FILES_PER_DEAL) return;

	let items: WorkDriveItem[] = [];
	try {
		items = await listWorkDriveFolder(accessToken, folderId, apiDomain, {
			perPage: 200,
			maxPages: 3
		});
	} catch (err) {
		console.warn(
			`[bot/ingest-workdrive] list ${folderId} failed:`,
			err instanceof Error ? err.message : err
		);
		return;
	}

	for (const item of items) {
		if (out.length >= MAX_FILES_PER_DEAL) return;
		if (item.type === 'folder') {
			await collectIngestibleFiles(accessToken, apiDomain, item.id, depth + 1, out);
			continue;
		}
		if (item.type !== 'file') continue;
		const source = pickSource(item.name, item.mime);
		if (!source) continue;
		out.push({ item, source });
	}
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

function safeIso(value: string | null | undefined): string {
	if (!value) return new Date().toISOString();
	const d = new Date(value);
	if (!Number.isNaN(d.getTime())) return d.toISOString();
	return new Date().toISOString();
}

function sanitizeForPostgres(s: string): string {
	// Postgres TEXT can't store U+0000. Strip nulls and other control chars
	// that PDFs sometimes contain (form feeds, etc.) which break JSON encoding.
	return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function parsePdf(buf: Buffer): Promise<string> {
	const pdfParse = (await import('pdf-parse')).default;
	const result = await pdfParse(buf);
	return typeof result.text === 'string' ? result.text : '';
}

async function parseDocx(buf: Buffer): Promise<string> {
	const mammoth = await import('mammoth');
	const result = await mammoth.extractRawText({ buffer: buf });
	return typeof result.value === 'string' ? result.value : '';
}

async function ingestFile(
	dealId: string,
	source: WdSource,
	item: WorkDriveItem,
	accessToken: string,
	apiDomain: string | undefined
): Promise<FileSyncOutcome> {
	const out: FileSyncOutcome = {
		file_id: item.id,
		name: item.name,
		size: item.size,
		status: 'skipped'
	};

	if (item.size != null && item.size > MAX_FILE_BYTES) {
		out.reason = `file > ${MAX_FILE_BYTES} bytes`;
		return out;
	}

	// Hash by WorkDrive's modifiedTime so re-syncs skip unchanged files cheaply.
	const fingerprint = hashBody(`${item.id}:${item.modifiedTime ?? ''}:${item.size ?? ''}`);
	const sourceId = `${dealId}:wd:${item.id}`;

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', sourceId)
		.maybeSingle();

	if (existing && existing.hash === fingerprint) {
		out.reason = 'unchanged';
		return out;
	}

	let buf: Buffer;
	try {
		buf = await downloadWorkDriveFile(accessToken, item.id, apiDomain);
	} catch (err) {
		out.status = 'failed';
		out.reason = err instanceof Error ? err.message.slice(0, 120) : 'download failed';
		return out;
	}

	let text = '';
	try {
		text = source === 'workdrive_pdf' ? await parsePdf(buf) : await parseDocx(buf);
	} catch (err) {
		out.status = 'failed';
		out.reason = err instanceof Error ? err.message.slice(0, 120) : 'parse failed';
		return out;
	}

	text = sanitizeForPostgres(text)
		.replace(/\s+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!text || text.length < 20) {
		out.reason = 'no extractable text';
		return out;
	}

	const subject = sanitizeForPostgres(item.name);
	const body = `File: ${subject}\n\n${text}`;

	const docRow = {
		deal_id: dealId,
		source,
		source_id: sourceId,
		source_url: null,
		author: null,
		occurred_at: safeIso(item.modifiedTime ?? item.createdTime),
		subject,
		body,
		metadata: {
			workdrive_file_id: item.id,
			mime: item.mime,
			size: item.size,
			char_count: text.length
		},
		hash: fingerprint
	};

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) {
			out.status = 'failed';
			out.reason = `update failed: ${error.message}`;
			return out;
		}
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) {
			out.status = 'failed';
			out.reason = `insert failed: ${error.message}`;
			return out;
		}
		documentId = inserted.id as string;
	}

	const chunks = chunkText(body, 1500, 200);
	if (chunks.length > 0) {
		const embeddings = await embed(chunks);
		const chunkRows = chunks.map((content, idx) => ({
			document_id: documentId,
			deal_id: dealId,
			chunk_index: idx,
			content,
			embedding: embeddings[idx] as unknown as string
		}));
		const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
		if (chunkErr) {
			out.status = 'failed';
			out.reason = `chunks insert failed: ${chunkErr.message}`;
			return out;
		}
	}

	out.status = 'inserted';
	return out;
}

export async function syncWorkDriveForDeal(
	dealId: string,
	opts: { folderIdOverride?: string | null } = {}
): Promise<WorkDriveSyncResult> {
	const { accessToken, apiDomain } = await getValidAccessToken();

	let folderId: string | null = null;
	let folderUrl: string | null = null;
	let folderSource: 'field' | 'url' | 'autodiscover' | 'override' | 'none' = 'none';
	let matchedFolderName: string | null | undefined = null;

	if (opts.folderIdOverride) {
		folderId = opts.folderIdOverride;
		folderSource = 'override';
	} else {
		const looked = await fetchDealFolder(accessToken, apiDomain, dealId);
		folderId = looked.folderId;
		folderUrl = looked.folderUrl;
		folderSource = looked.source;
		matchedFolderName = looked.matchedFolderName ?? null;
		if (looked.source === 'autodiscover' && looked.matchedFolderName) {
			console.log(
				`[bot/ingest-workdrive] auto-discovered folder "${looked.matchedFolderName}" for deal ${dealId}`
			);
		}
	}

	const res: WorkDriveSyncResult = {
		dealId,
		folderId,
		folderUrl,
		processed: 0,
		inserted: 0,
		skipped: 0,
		failed: 0,
		files: []
	};
	if (folderSource === 'autodiscover' && matchedFolderName) {
		(res as any).matched_folder_name = matchedFolderName;
		(res as any).folder_source = 'autodiscover';
	} else {
		(res as any).folder_source = folderSource;
	}

	if (!folderId) {
		res.error = WORKDRIVE_PARENT_FOLDER_ID
			? 'no folder on Deal and no matching subfolder in BOT_WORKDRIVE_PARENT_FOLDER_ID'
			: 'no WorkDrive folder on Deal (set WorkDrive_Folder_ID / Client_Portal_Folder, or set BOT_WORKDRIVE_PARENT_FOLDER_ID env to enable auto-discovery)';
		return res;
	}

	const collected: { item: WorkDriveItem; source: WdSource }[] = [];
	await collectIngestibleFiles(accessToken, apiDomain, folderId, 0, collected);

	if (collected.length === 0) {
		res.error = 'no PDF or DOCX files found in folder';
		return res;
	}

	for (const { item, source } of collected) {
		res.processed += 1;
		const outcome = await ingestFile(dealId, source, item, accessToken, apiDomain);
		res.files.push(outcome);
		if (outcome.status === 'inserted') {
			res.inserted += 1;
			console.log(`[bot/ingest-workdrive] inserted "${item.name}" (${source})`);
		} else if (outcome.status === 'failed') {
			res.failed += 1;
			console.warn(
				`[bot/ingest-workdrive] FAILED "${item.name}" (${source}): ${outcome.reason ?? 'unknown'}`
			);
		} else {
			res.skipped += 1;
			console.log(
				`[bot/ingest-workdrive] skipped "${item.name}" (${source}): ${outcome.reason ?? 'unknown'}`
			);
		}
	}

	return res;
}
