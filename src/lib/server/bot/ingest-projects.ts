import { createHash } from 'crypto';
import { supabase } from '$lib/server/db';
import {
	getAllProjectTasks,
	getAllProjectActivities,
	getProject,
	parseZohoProjectIds
} from '$lib/server/projects';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { chunkText, embed } from './embeddings';

type ProjectsSource = 'zoho_projects_task' | 'zoho_projects_activity';

export interface ProjectsSyncResult {
	dealId: string;
	projectIds: string[];
	tasks: { source: 'zoho_projects_task'; processed: number; inserted: number; skipped: number };
	activities: { source: 'zoho_projects_activity'; processed: number; inserted: number; skipped: number };
	error?: string;
}

function hashBody(s: string): string {
	return createHash('sha256').update(s).digest('hex');
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho not connected');
	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
}

async function fetchDealProjectIds(dealId: string): Promise<string[]> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const res = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=Zoho_Projects_ID,Projects_Project_ID,Project_ID`,
		{},
		apiDomain
	);
	const rec = res?.data?.[0] ?? {};
	const candidates = [rec.Zoho_Projects_ID, rec.Projects_Project_ID, rec.Project_ID].filter(Boolean);
	const out = new Set<string>();
	for (const c of candidates) {
		for (const id of parseZohoProjectIds(c)) out.add(id);
	}
	return Array.from(out);
}

function safeIso(value: any): string {
	if (!value) return new Date().toISOString();
	// Zoho Projects returns dates like "06-03-2026" or millis. Try millis first.
	const n = Number(value);
	if (Number.isFinite(n) && n > 0) {
		const d = new Date(n > 1e12 ? n : n * 1000);
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}
	const d = new Date(String(value));
	if (!Number.isNaN(d.getTime())) return d.toISOString();
	return new Date().toISOString();
}

function renderTask(task: any, projectName: string | null): {
	subject: string;
	body: string;
	sourceId: string;
	occurredAt: string;
} {
	const id = String(task.id ?? task.id_string ?? '');
	const name = String(task.name ?? '(untitled task)').trim();
	const status = task.status?.name ?? task.status ?? 'unknown';
	const owner =
		task.details?.owners?.map((o: any) => o.name).filter(Boolean).join(', ') ??
		task.owner?.name ??
		'';
	const tasklist = task.tasklist?.name ?? '';
	const milestone = task.milestone?.name ?? '';
	const startDate = task.start_date ?? task.start_date_format ?? '';
	const endDate = task.end_date ?? task.end_date_format ?? '';
	const completedAt = task.completed_time ?? task.closed_time ?? '';
	const percentComplete = task.percent_complete != null ? `${task.percent_complete}%` : '';
	const description = task.description ?? '';
	const customStatus = task.custom_status?.name ?? '';

	const lines: string[] = [];
	lines.push(`Task: ${name}`);
	lines.push(`Project: ${projectName ?? '(unknown)'}`);
	if (tasklist) lines.push(`Tasklist: ${tasklist}`);
	if (milestone) lines.push(`Milestone: ${milestone}`);
	lines.push(`Status: ${status}${customStatus && customStatus !== status ? ` (${customStatus})` : ''}`);
	if (owner) lines.push(`Owner: ${owner}`);
	if (percentComplete) lines.push(`Percent complete: ${percentComplete}`);
	if (startDate) lines.push(`Start: ${startDate}`);
	if (endDate) lines.push(`Due: ${endDate}`);
	if (completedAt) lines.push(`Completed: ${completedAt}`);
	if (description) lines.push(`Description: ${String(description).replace(/<[^>]+>/g, '').slice(0, 1000)}`);

	const body = lines.join('\n');
	const occurredAt = safeIso(
		task.last_updated_time ?? task.modified_time ?? task.created_time ?? endDate ?? startDate
	);
	return { subject: `Task · ${name} · ${status}`, body, sourceId: `task:${id}`, occurredAt };
}

function renderActivity(activity: any, projectName: string | null): {
	subject: string;
	body: string;
	sourceId: string;
	occurredAt: string;
} {
	const id = String(activity.id ?? activity.activity_id ?? '');
	const actor = activity.activity_by ?? activity.user?.name ?? activity.name ?? '';
	const activityType = activity.activity_type ?? activity.activity_for ?? activity.state ?? '';
	const itemName = activity.name ?? activity.activity_name ?? activity.task_name ?? '';
	const time = activity.time_long ?? activity.activity_time ?? activity.time ?? '';
	const content = activity.content ?? activity.activity_data ?? '';

	const lines: string[] = [];
	lines.push(`Activity: ${activityType || 'update'} by ${actor || 'unknown'}`);
	lines.push(`Project: ${projectName ?? '(unknown)'}`);
	if (itemName) lines.push(`Item: ${itemName}`);
	if (content) lines.push(`Detail: ${String(content).replace(/<[^>]+>/g, '').slice(0, 1000)}`);
	if (time) lines.push(`Time: ${time}`);

	const body = lines.join('\n');
	const occurredAt = safeIso(time);
	return {
		subject: `Activity · ${activityType || 'update'} · ${itemName || '(item)'}`,
		body,
		sourceId: `activity:${id}`,
		occurredAt
	};
}

async function ingestRendered(
	dealId: string,
	source: ProjectsSource,
	author: string | null,
	rec: { subject: string; body: string; sourceId: string; occurredAt: string; metadata?: any }
): Promise<'inserted' | 'skipped'> {
	const docRow = {
		deal_id: dealId,
		source,
		source_id: rec.sourceId,
		source_url: null,
		author,
		occurred_at: rec.occurredAt,
		subject: rec.subject,
		body: rec.body,
		metadata: rec.metadata ?? {},
		hash: hashBody(rec.body)
	};

	const { data: existing } = await supabase
		.from('bot_documents')
		.select('id, hash')
		.eq('source', source)
		.eq('source_id', rec.sourceId)
		.maybeSingle();

	if (existing && existing.hash === docRow.hash) return 'skipped';

	let documentId: string;
	if (existing) {
		const { error } = await supabase.from('bot_documents').update(docRow).eq('id', existing.id);
		if (error) throw new Error(`bot_documents update failed: ${error.message}`);
		documentId = existing.id as string;
		await supabase.from('bot_chunks').delete().eq('document_id', documentId);
	} else {
		const { data: inserted, error } = await supabase
			.from('bot_documents')
			.insert(docRow)
			.select('id')
			.single();
		if (error) throw new Error(`bot_documents insert failed: ${error.message}`);
		documentId = inserted.id as string;
	}

	const chunks = chunkText(`${rec.subject}\n${rec.body}`, 1500, 200);
	if (chunks.length === 0) return 'inserted';
	const embeddings = await embed(chunks);
	const chunkRows = chunks.map((content, idx) => ({
		document_id: documentId,
		deal_id: dealId,
		chunk_index: idx,
		content,
		embedding: embeddings[idx] as unknown as string
	}));
	const { error: chunkErr } = await supabase.from('bot_chunks').insert(chunkRows);
	if (chunkErr) throw new Error(`bot_chunks insert failed: ${chunkErr.message}`);
	return 'inserted';
}

export async function syncProjectsForDeal(dealId: string): Promise<ProjectsSyncResult> {
	const result: ProjectsSyncResult = {
		dealId,
		projectIds: [],
		tasks: { source: 'zoho_projects_task', processed: 0, inserted: 0, skipped: 0 },
		activities: { source: 'zoho_projects_activity', processed: 0, inserted: 0, skipped: 0 }
	};

	let projectIds: string[];
	try {
		projectIds = await fetchDealProjectIds(dealId);
	} catch (err) {
		result.error = err instanceof Error ? err.message : 'fetch project ids failed';
		return result;
	}
	result.projectIds = projectIds;
	if (projectIds.length === 0) {
		result.error = 'no Zoho Projects ID linked to Deal';
		return result;
	}

	for (const projectId of projectIds) {
		// Fetch project name once for context
		let projectName: string | null = null;
		try {
			const proj = await getProject(projectId);
			projectName = proj?.name ?? proj?.title ?? null;
		} catch {
			/* ignore */
		}

		// Tasks
		try {
			const tasks = await getAllProjectTasks(projectId);
			for (const task of tasks) {
				const rec = renderTask(task, projectName);
				result.tasks.processed += 1;
				try {
					const status = await ingestRendered(dealId, 'zoho_projects_task', projectName, {
						...rec,
						metadata: { project_id: projectId, task_id: task.id }
					});
					if (status === 'inserted') result.tasks.inserted += 1;
					else result.tasks.skipped += 1;
				} catch (err) {
					result.tasks.skipped += 1;
					console.warn(
						'[bot/ingest-projects] task failed:',
						err instanceof Error ? err.message : err
					);
				}
			}
		} catch (err) {
			console.warn(
				`[bot/ingest-projects] tasks fetch failed for ${projectId}:`,
				err instanceof Error ? err.message : err
			);
		}

		// Activities (field updates posted via Zoho Projects activity stream)
		try {
			const activities = await getAllProjectActivities(projectId);
			for (const activity of activities) {
				const rec = renderActivity(activity, projectName);
				result.activities.processed += 1;
				try {
					const status = await ingestRendered(
						dealId,
						'zoho_projects_activity',
						projectName,
						{ ...rec, metadata: { project_id: projectId } }
					);
					if (status === 'inserted') result.activities.inserted += 1;
					else result.activities.skipped += 1;
				} catch (err) {
					result.activities.skipped += 1;
					console.warn(
						'[bot/ingest-projects] activity failed:',
						err instanceof Error ? err.message : err
					);
				}
			}
		} catch (err) {
			console.warn(
				`[bot/ingest-projects] activities fetch failed for ${projectId}:`,
				err instanceof Error ? err.message : err
			);
		}
	}

	return result;
}
