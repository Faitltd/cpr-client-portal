import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { getAllProjectTasks } from '$lib/server/projects';
import { insertSubtasks } from '$lib/server/db';
import { TRADE_CHECKLIST_SLUGS, getTradeChecklist } from './trade-checklists';

const MODEL = env.SUBTASK_MATCH_MODEL || env.BOT_CHAT_MODEL || 'gpt-4o-mini';

function getTaskId(t: any): string {
	return String(t?.id ?? t?.id_string ?? '').trim();
}
function getTaskName(t: any): string {
	return String(t?.name ?? t?.task_name ?? '').trim();
}

/**
 * Ask GPT to map each project task to the single best trade-checklist slug
 * (or null). GPT only chooses which checklist applies — it never authors items.
 */
async function classifyTrades(taskNames: string[]): Promise<(string | null)[]> {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey || taskNames.length === 0) return taskNames.map(() => null);
	const client = new OpenAI({ apiKey });
	const slugs = TRADE_CHECKLIST_SLUGS;
	const sys =
		`You map home-renovation project tasks to a trade quality-control checklist. ` +
		`Allowed trade slugs: ${slugs.join(', ')}. ` +
		`For each task, choose the single best-matching slug, or null if none clearly applies ` +
		`(e.g. generic admin/scheduling tasks). Respond ONLY as JSON: {"trades": [<slug-or-null>, ...]} ` +
		`with the same length and order as the input tasks.`;
	const user = `Tasks:\n${taskNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
	try {
		const res = await client.chat.completions.create({
			model: MODEL,
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: sys },
				{ role: 'user', content: user }
			]
		});
		const raw = res.choices?.[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(raw);
		const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.trades) ? parsed.trades : [];
		return taskNames.map((_, i) => {
			const v = arr[i];
			return typeof v === 'string' && slugs.includes(v) ? v : null;
		});
	} catch (err) {
		console.warn('[generate-subtasks] classify failed:', err instanceof Error ? err.message : err);
		return taskNames.map(() => null);
	}
}

export interface GenerateSubtasksResult {
	tasks: number;
	matched: number;
	inserted: number;
}

/**
 * For every task in a Zoho project, classify its trade and attach that trade's
 * full QC checklist (from the library) as subtasks. Idempotent — re-running
 * won't duplicate (unique on parent_task_id + label).
 */
export async function generateSubtasksForProject(opts: {
	dealId: string | null;
	projectId: string;
}): Promise<GenerateSubtasksResult> {
	const raw = await getAllProjectTasks(opts.projectId, 100).catch(() => []);
	const named = (Array.isArray(raw) ? raw : [])
		.map((t) => ({ id: getTaskId(t), name: getTaskName(t) }))
		.filter((t) => t.id && t.name);
	if (named.length === 0) return { tasks: 0, matched: 0, inserted: 0 };

	const trades = await classifyTrades(named.map((t) => t.name));

	let matched = 0;
	let inserted = 0;
	for (let i = 0; i < named.length; i++) {
		const slug = trades[i];
		if (!slug) continue;
		const checklist = getTradeChecklist(slug);
		if (!checklist || checklist.items.length === 0) continue;
		matched += 1;
		const rows = checklist.items.map((label, idx) => ({
			deal_id: opts.dealId,
			project_id: opts.projectId,
			parent_task_id: named[i].id,
			trade_slug: slug,
			label,
			sort_order: idx
		}));
		inserted += await insertSubtasks(rows);
	}
	return { tasks: named.length, matched, inserted };
}
