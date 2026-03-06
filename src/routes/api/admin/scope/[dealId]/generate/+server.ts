import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { generateProject } from '$lib/server/project-generator';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: { start_date?: string } | undefined;
	try {
		body = await request.json();
	} catch {
		body = undefined;
	}

	try {
		const result = await generateProject(params.dealId, body?.start_date);
		return json({ data: result });
	} catch (err) {
		console.error('POST /api/admin/scope/[dealId]/generate error:', err);
		const message = err instanceof Error ? err.message : 'Failed to generate project';
		return json({ message }, { status: 500 });
	}
};
