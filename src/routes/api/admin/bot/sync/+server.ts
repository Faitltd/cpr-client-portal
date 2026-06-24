import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { syncCliqForDeal } from '$lib/server/bot/ingest-cliq';
import { syncBooksForDeal } from '$lib/server/bot/ingest-books';
import { syncMailForDeal } from '$lib/server/bot/ingest-mail';
import { syncCrmEmailsForDeal } from '$lib/server/bot/ingest-crm-emails';
import { syncWorkDriveForDeal } from '$lib/server/bot/ingest-workdrive';
import { syncProjectsForDeal } from '$lib/server/bot/ingest-projects';
import { syncSignForDeal } from '$lib/server/bot/ingest-sign';
import { syncCalendarForDeal } from '$lib/server/bot/ingest-calendar';
import { syncShiftsForDeal } from '$lib/server/bot/ingest-shifts';
import type { RequestHandler } from './$types';

type SyncSource =
	| 'cliq'
	| 'books'
	| 'mail'
	| 'crm_email'
	| 'workdrive'
	| 'projects'
	| 'sign'
	| 'calendar'
	| 'shifts'
	| 'all';

function isSource(x: string): x is SyncSource {
	return (
		x === 'cliq' ||
		x === 'books' ||
		x === 'mail' ||
		x === 'crm_email' ||
		x === 'workdrive' ||
		x === 'projects' ||
		x === 'sign' ||
		x === 'calendar' ||
		x === 'shifts' ||
		x === 'all'
	);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: { dealId?: string; source?: string; folderId?: string };
	try {
		body = (await request.json()) as { dealId?: string; source?: string; folderId?: string };
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}

	const dealId = (body.dealId ?? '').trim();
	const sourceArg = (body.source ?? 'cliq').trim();
	const folderIdOverride = (body.folderId ?? '').trim() || null;
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });
	if (!isSource(sourceArg)) return json({ message: `Unknown source: ${sourceArg}` }, { status: 400 });

	const out: Record<string, any> = {};
	const errors: string[] = [];

	async function runOne(
		name:
			| 'cliq'
			| 'books'
			| 'mail'
			| 'crm_email'
			| 'workdrive'
			| 'projects'
			| 'sign'
			| 'calendar'
			| 'shifts'
	) {
		try {
			if (name === 'cliq') out.cliq = await syncCliqForDeal(dealId);
			if (name === 'books') out.books = await syncBooksForDeal(dealId);
			if (name === 'mail') out.mail = await syncMailForDeal(dealId);
			if (name === 'crm_email') out.crm_email = await syncCrmEmailsForDeal(dealId);
			if (name === 'workdrive')
				out.workdrive = await syncWorkDriveForDeal(dealId, { folderIdOverride });
			if (name === 'projects') out.projects = await syncProjectsForDeal(dealId);
			if (name === 'sign') out.sign = await syncSignForDeal(dealId);
			if (name === 'calendar') out.calendar = await syncCalendarForDeal(dealId);
			if (name === 'shifts') out.shifts = await syncShiftsForDeal(dealId);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'sync failed';
			out[name] = { error: msg };
			errors.push(`${name}: ${msg}`);
		}
	}

	if (sourceArg === 'all') {
		await Promise.all([
			runOne('cliq'),
			runOne('books'),
			runOne('mail'),
			runOne('crm_email'),
			runOne('workdrive'),
			runOne('projects'),
			runOne('sign'),
			runOne('calendar'),
			runOne('shifts')
		]);
	} else {
		await runOne(sourceArg);
	}

	return json({ ok: errors.length === 0, result: out, errors });
};
