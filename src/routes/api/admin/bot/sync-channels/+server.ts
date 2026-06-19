import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidAdminSession } from '$lib/server/admin';
import { syncAllCliqChannels } from '$lib/server/bot/ingest-cliq-channels';
import type { RequestHandler } from './$types';

/**
 * Master Bot sync — pulls EVERY Cliq channel into the corpus so the cross-deal
 * Master Bot can search all of them (incl. company-wide channels like
 * #Meeting Summaries that aren't linked to any Deal).
 *
 * Auth: admin session cookie, or Bearer BOT_CRON_SECRET for scheduled runs.
 * Detached mode (?detached=1 or {detached:true}) fires and returns immediately.
 */
function authorize(request: Request, cookies: Parameters<RequestHandler>[0]['cookies']): boolean {
	if (isValidAdminSession(cookies.get('admin_session'))) return true;
	const auth = request.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	const secret = env.BOT_CRON_SECRET ?? '';
	return Boolean(match && secret && match[1] === secret);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!authorize(request, cookies)) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		body = {};
	}
	const url = new URL(request.url);
	const detached = url.searchParams.get('detached') === '1' || body?.detached === true;

	if (detached) {
		syncAllCliqChannels().catch((err) => {
			console.warn(
				'[admin/sync-channels] detached run failed:',
				err instanceof Error ? err.message : err
			);
		});
		return json({ ok: true, started: true, detached: true });
	}

	try {
		const result = await syncAllCliqChannels();
		return json({ ok: !result.error, result });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'sync-channels failed';
		return json({ ok: false, message }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ request, cookies }) => POST({ request, cookies } as any);
