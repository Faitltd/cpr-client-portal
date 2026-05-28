import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { syncAll, type SyncSource, type SyncTrigger } from '$lib/server/bot/sync-all';
import type { RequestHandler } from './$types';

function authorize(request: Request, cookies: Parameters<RequestHandler>[0]['cookies']): SyncTrigger | null {
	if (isValidAdminSession(cookies.get('admin_session'))) return 'admin';
	const auth = request.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	const secret = env.BOT_CRON_SECRET ?? '';
	if (match && secret && match[1] === secret) return 'cron';
	return null;
}

function parseSources(raw: unknown): SyncSource[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const allowed = new Set(['cliq', 'mail', 'books']);
	const out = raw.filter((x): x is SyncSource => typeof x === 'string' && allowed.has(x));
	return out.length > 0 ? out : undefined;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const trigger = authorize(request, cookies);
	if (!trigger) return json({ message: 'Unauthorized' }, { status: 401 });

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const sources = parseSources(body?.sources);
	const limit = typeof body?.limit === 'number' ? body.limit : undefined;
	const dealIds = Array.isArray(body?.dealIds)
		? body.dealIds.filter((x: unknown) => typeof x === 'string')
		: undefined;

	try {
		const result = await syncAll({ trigger, sources, limit, dealIds });
		return json({ ok: true, result });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'sync-all failed';
		return json({ ok: false, message }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ request, cookies }) => {
	// Convenience for Render Cron Job's curl one-liner.
	return POST({ request, cookies } as any);
};
