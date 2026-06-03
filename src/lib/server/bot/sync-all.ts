import { env } from '$env/dynamic/private';
import { supabase, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import { syncCliqForDeal } from './ingest-cliq';
import { syncBooksForDeal } from './ingest-books';
import { syncMailForDeal } from './ingest-mail';
import { syncCrmEmailsForDeal } from './ingest-crm-emails';
import { syncWorkDriveForDeal } from './ingest-workdrive';
import { syncProjectsForDeal } from './ingest-projects';

export type SyncSource = 'cliq' | 'books' | 'mail' | 'crm_email' | 'workdrive' | 'projects';
export type SyncTrigger = 'cron' | 'manual' | 'admin';

// Stages to EXCLUDE from sync. Default is just "Lost". Override via env if you
// want to skip e.g. Completed too: BOT_SYNC_EXCLUDE_STAGES=Lost,Completed
const EXCLUDE_STAGES = (env.BOT_SYNC_EXCLUDE_STAGES ?? 'Lost')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

const DEFAULT_BATCH_LIMIT = Number(env.BOT_SYNC_BATCH_LIMIT ?? '25');

interface ActiveDeal {
	id: string;
	name: string;
	stage: string;
	modifiedTime: string | null;
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
			api_domain: apiDomain || null
		});
	}
	return { accessToken, apiDomain };
}

/**
 * Pull active Deals from Zoho CRM, ordered by most recently modified.
 * "Active" = stage in BOT_SYNC_STAGES.
 */
async function listActiveDeals(limit: number): Promise<ActiveDeal[]> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	// Sync EVERY Deal except those in EXCLUDE_STAGES (default: Lost).
	const stageClauses = EXCLUDE_STAGES.map((s) => `(Stage:not_equal:${s})`).join('and');
	const criteria = encodeURIComponent(`(${stageClauses})`);
	const fields = 'Deal_Name,Stage,Modified_Time';
	const result = await zohoApiCall(
		accessToken,
		`/Deals/search?criteria=${criteria}&fields=${fields}&sort_by=Modified_Time&sort_order=desc&per_page=${Math.min(limit, 200)}`,
		{},
		apiDomain
	);
	const records = Array.isArray(result?.data) ? result.data : [];
	console.log(`[bot/sync-all] listActiveDeals matched ${records.length} deals (excluding: ${EXCLUDE_STAGES.join(', ')})`);
	return records.map((rec: any) => ({
		id: String(rec.id),
		name: typeof rec.Deal_Name === 'string' ? rec.Deal_Name : '',
		stage: typeof rec.Stage === 'string' ? rec.Stage : '',
		modifiedTime: typeof rec.Modified_Time === 'string' ? rec.Modified_Time : null
	}));
}

export interface DealSyncSummary {
	deal_id: string;
	deal_name: string;
	stage: string;
	cliq?: { inserted: number; skipped: number; error?: string };
	books?: { inserted: number; skipped: number; error?: string };
	mail?: { inserted: number; skipped: number; error?: string };
	crm_email?: { inserted: number; skipped: number; error?: string };
	workdrive?: { inserted: number; skipped: number; error?: string };
	error?: string;
}

function tallyCliq(r: any) {
	if (!r) return undefined;
	const i = r.internal ?? {};
	const e = r.external ?? {};
	return {
		inserted: (i.inserted ?? 0) + (e.inserted ?? 0),
		skipped: (i.skipped ?? 0) + (e.skipped ?? 0),
		error: [i.error, e.error].filter(Boolean).join('; ') || undefined
	};
}

function tallyBooks(r: any) {
	if (!r) return undefined;
	const inv = r.invoices ?? {};
	const est = r.estimates ?? {};
	const pay = r.payments ?? {};
	return {
		inserted: (inv.inserted ?? 0) + (est.inserted ?? 0) + (pay.inserted ?? 0),
		skipped: (inv.skipped ?? 0) + (est.skipped ?? 0) + (pay.skipped ?? 0),
		error: r.error ?? ([inv.error, est.error, pay.error].filter(Boolean).join('; ') || undefined)
	};
}

function tallyCrmEmail(r: any) {
	if (!r) return undefined;
	return {
		inserted: r.inserted ?? 0,
		skipped: r.skipped ?? 0,
		error: r.error ?? undefined
	};
}

function tallyWorkdrive(r: any) {
	if (!r) return undefined;
	return {
		inserted: r.inserted ?? 0,
		skipped: r.skipped ?? 0,
		error: r.error ?? (r.failed > 0 ? `${r.failed} file(s) failed` : undefined)
	};
}

function tallyMail(r: any) {
	if (!r) return undefined;
	if (r.error) return { inserted: 0, skipped: 0, error: r.error };
	const accts = Array.isArray(r.accounts) ? r.accounts : [];
	const totals = accts.reduce(
		(acc: any, a: any) => ({
			inserted: acc.inserted + (a.inserted ?? 0),
			skipped: acc.skipped + (a.skipped ?? 0),
			errors: acc.errors + (a.error ? 1 : 0)
		}),
		{ inserted: 0, skipped: 0, errors: 0 }
	);
	return {
		inserted: totals.inserted,
		skipped: totals.skipped,
		error: totals.errors > 0 ? `${totals.errors} mailbox error(s)` : undefined
	};
}

export interface SyncAllOptions {
	trigger: SyncTrigger;
	sources?: SyncSource[];
	limit?: number;
	dealIds?: string[];
}

export interface SyncAllResult {
	runId: string;
	dealCount: number;
	okCount: number;
	errorCount: number;
	durationMs: number;
	deals: DealSyncSummary[];
}

export async function syncAll(opts: SyncAllOptions): Promise<SyncAllResult> {
	const sources =
		opts.sources && opts.sources.length > 0
			? opts.sources
			: (['cliq', 'mail', 'books', 'crm_email', 'workdrive'] as SyncSource[]);
	const startedAt = Date.now();

	const { data: runInsert, error: runErr } = await supabase
		.from('bot_sync_runs')
		.insert({
			trigger: opts.trigger,
			sources,
			deal_count: 0,
			ok_count: 0,
			error_count: 0
		})
		.select('id')
		.single();
	if (runErr) throw new Error(`bot_sync_runs insert failed: ${runErr.message}`);
	const runId = runInsert.id as string;

	let deals: ActiveDeal[];
	if (opts.dealIds && opts.dealIds.length > 0) {
		deals = opts.dealIds.map((id) => ({ id, name: '', stage: '', modifiedTime: null }));
	} else {
		try {
			deals = await listActiveDeals(opts.limit ?? DEFAULT_BATCH_LIMIT);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'listActiveDeals failed';
			await supabase
				.from('bot_sync_runs')
				.update({
					finished_at: new Date().toISOString(),
					duration_ms: Date.now() - startedAt,
					summary: { error: message }
				})
				.eq('id', runId);
			throw err;
		}
	}

	const dealSummaries: DealSyncSummary[] = [];
	let ok = 0;
	let errs = 0;

	for (const d of deals) {
		const summary: DealSyncSummary = { deal_id: d.id, deal_name: d.name, stage: d.stage };
		try {
			const [cliq, books, mail, crmEmail, workdrive, projects] = await Promise.all([
				sources.includes('cliq')
					? syncCliqForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null,
				sources.includes('books')
					? syncBooksForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null,
				sources.includes('mail')
					? syncMailForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null,
				sources.includes('crm_email')
					? syncCrmEmailsForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null,
				sources.includes('workdrive')
					? syncWorkDriveForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null,
				sources.includes('projects')
					? syncProjectsForDeal(d.id).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))
					: null
			]);
			if (cliq) summary.cliq = tallyCliq(cliq);
			if (books) summary.books = tallyBooks(books);
			if (mail) summary.mail = tallyMail(mail);
			if (crmEmail) summary.crm_email = tallyCrmEmail(crmEmail);
			if (workdrive) summary.workdrive = tallyWorkdrive(workdrive);
			if (projects) (summary as any).projects = projects;

			const allErrs = [
				summary.cliq?.error,
				summary.books?.error,
				summary.mail?.error,
				summary.crm_email?.error,
				summary.workdrive?.error,
				(projects as any)?.error
			].filter(Boolean) as string[];

			// "Expected" errors = data hasn't been set up on the Deal yet (not a
			// code bug). Don't count these as deal-level errors.
			const EXPECTED_PATTERNS = [
				/no channel id on Deal/i,
				/no contact email/i,
				/no Books customer with email/i,
				/no Client_Portal_Folder/i,
				/no WorkDrive folder on Deal/i,
				/no folder on Deal and no matching subfolder/i,
				/no PDF or DOCX files found/i,
				/cannot match Mail/i,
				/no Zoho Projects ID linked to Deal/i
			];
			const realErrs = allErrs.filter(
				(e) => !EXPECTED_PATTERNS.some((p) => p.test(e))
			);
			if (realErrs.length > 0) errs += 1;
			else ok += 1;
		} catch (err) {
			summary.error = err instanceof Error ? err.message : 'failed';
			errs += 1;
		}
		dealSummaries.push(summary);
	}

	const durationMs = Date.now() - startedAt;
	await supabase
		.from('bot_sync_runs')
		.update({
			finished_at: new Date().toISOString(),
			duration_ms: durationMs,
			deal_count: deals.length,
			ok_count: ok,
			error_count: errs,
			deals: dealSummaries,
			summary: { sources }
		})
		.eq('id', runId);

	return {
		runId,
		dealCount: deals.length,
		okCount: ok,
		errorCount: errs,
		durationMs,
		deals: dealSummaries
	};
}
