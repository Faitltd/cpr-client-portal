import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { syncAll } from '$lib/server/bot/sync-all';
import type { RequestHandler } from './$types';

/**
 * Scheduled background sync of every active deal. Hit by a Render Cron Job
 * every ~2 hours so the bot stays current without anyone clicking buttons.
 *
 * Auth: shared secret in the `x-cron-secret` header (set BOT_CRON_SECRET in
 * Render env vars and the cron job's headers). Without that, no caller can
 * trigger a full org-wide sync from the public internet.
 *
 * Returns immediately and runs the sync asynchronously — Render's HTTP
 * timeout is ~5 minutes but a full org sync can take much longer.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.BOT_CRON_SECRET;
	const got = request.headers.get('x-cron-secret') ?? '';
	if (!expected || got !== expected) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	// Fire-and-forget. Each source is its own try/catch inside syncAll so a
	// single failure doesn't stop the rest.
	syncAll({
		sources: ['cliq', 'books', 'mail', 'crm_email', 'workdrive', 'projects', 'sign'],
		trigger: 'cron'
	}).catch((err) => {
		console.warn('[cron/sync-active-deals] syncAll failed:', err?.message ?? err);
	});

	return json({ ok: true, started: true, startedAt: new Date().toISOString() });
};
