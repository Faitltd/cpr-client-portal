import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { getDealsForClient } from '$lib/server/projects';
import { syncWorkDriveForDeal } from '$lib/server/bot/ingest-workdrive';
import { syncProjectsForDeal } from '$lib/server/bot/ingest-projects';
import { syncBooksForDeal } from '$lib/server/bot/ingest-books';
import { syncCliqForDeal } from '$lib/server/bot/ingest-cliq';
import { syncSignForDeal } from '$lib/server/bot/ingest-sign';
import type { RequestHandler } from './$types';

/**
 * Silent auto-sync for client dashboard. Fires on page load so the bot
 * always reflects the latest WorkDrive / Projects / Books / Cliq state for
 * the client's deal. Client has no Sync UI — this is the only refresh path.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const access = await getBotAccess(cookies);
	if (!access || (access.role !== 'client' && access.role !== 'admin')) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	if (access.role === 'client' && !access.clientId) {
		return json({ message: 'Client session missing id' }, { status: 401 });
	}

	let body: { dealId?: string };
	try {
		body = (await request.json()) as { dealId?: string };
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}
	const dealId = (body.dealId ?? '').trim();
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });

	if (access.role === 'client') {
		const allowed = await getDealsForClient(
			access.clientZohoContactId ?? null,
			access.email || null
		).catch(() => [] as any[]);
		const allowedIds = new Set(
			(allowed ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
		);
		if (!allowedIds.has(dealId)) {
			return json({ message: 'You do not have access to this Deal' }, { status: 403 });
		}
	}

	// Fire-and-forget — client doesn't wait. The bot picks up fresh chunks on
	// the next question.
	syncWorkDriveForDeal(dealId).catch((err) => {
		console.warn(`[bot/client-sync] WorkDrive failed for ${dealId}:`, err?.message ?? err);
	});
	syncProjectsForDeal(dealId).catch((err) => {
		console.warn(`[bot/client-sync] Projects failed for ${dealId}:`, err?.message ?? err);
	});
	syncBooksForDeal(dealId).catch((err) => {
		console.warn(`[bot/client-sync] Books failed for ${dealId}:`, err?.message ?? err);
	});
	syncCliqForDeal(dealId).catch((err) => {
		console.warn(`[bot/client-sync] Cliq failed for ${dealId}:`, err?.message ?? err);
	});
	syncSignForDeal(dealId).catch((err) => {
		console.warn(`[bot/client-sync] Sign failed for ${dealId}:`, err?.message ?? err);
	});

	return json({ ok: true, dealId, started: true });
};
