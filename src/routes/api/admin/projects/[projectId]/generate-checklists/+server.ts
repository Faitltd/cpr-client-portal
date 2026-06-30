import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { generateSubtasksForProject } from '$lib/server/checklists/generate-subtasks';
import type { RequestHandler } from './$types';

/**
 * Admin: generate QC checklist subtasks for every task in a Zoho project.
 * GPT classifies each task's trade; the matching trade's full checklist is
 * attached as subtasks. Idempotent.
 *   POST /api/admin/projects/{projectId}/generate-checklists  body: { dealId? }
 */
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	const projectId = (params.projectId ?? '').trim();
	if (!projectId) return json({ message: 'projectId required' }, { status: 400 });

	let body: { dealId?: string } = {};
	try {
		body = (await request.json()) as { dealId?: string };
	} catch {
		body = {};
	}
	const dealId = (body.dealId ?? '').trim() || null;

	try {
		const result = await generateSubtasksForProject({ dealId, projectId });
		return json({ ok: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to generate checklists';
		return json({ ok: false, message }, { status: 500 });
	}
};
