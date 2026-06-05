import { json } from '@sveltejs/kit';
import { getBotAccess } from '$lib/server/bot-access';
import { loadTradePageContext } from '$lib/server/trade-page-data';
import { syncWorkDriveForDeal } from '$lib/server/bot/ingest-workdrive';
import { syncProjectsForDeal } from '$lib/server/bot/ingest-projects';
import { syncSignForDeal } from '$lib/server/bot/ingest-sign';
import type { RequestHandler } from './$types';

/**
 * Background sync for trade partners. The page client fires this on mount;
 * the response returns immediately while the sync runs in the background.
 *
 * Trade partners never see Sync UI, so a quiet auto-sync on page load is the
 * only way fresh WorkDrive files reach the bot for them. We only refresh
 * WorkDrive (the only source trade partners can see) to keep the call cheap.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const access = await getBotAccess(cookies);
	if (!access || (access.role !== 'trade_partner' && access.role !== 'admin')) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	let body: { dealId?: string };
	try {
		body = (await request.json()) as { dealId?: string };
	} catch {
		return json({ message: 'Invalid JSON' }, { status: 400 });
	}
	const dealId = (body.dealId ?? '').trim();
	if (!dealId) return json({ message: 'dealId required' }, { status: 400 });

	// Trade partners can only refresh their own deals. Admins skip the check.
	if (access.role === 'trade_partner') {
		const tradeToken = cookies.get('trade_session') ?? '';
		const ctx = await loadTradePageContext(tradeToken, { includeDetailFields: false });
		if (ctx.redirectTo) {
			return json({ message: 'Trade session expired' }, { status: 401 });
		}
		const allowedDealIds = new Set(
			(ctx.deals ?? []).map((d: any) => String(d.id ?? d.deal_id ?? '')).filter(Boolean)
		);
		if (!allowedDealIds.has(dealId)) {
			return json({ message: 'You do not have access to this Deal' }, { status: 403 });
		}
	}

	// Fire and forget — the client doesn't wait. Log errors but don't surface.
	syncWorkDriveForDeal(dealId).catch((err) => {
		const msg = err instanceof Error ? err.message : 'unknown';
		console.warn(`[bot/trade-sync] WorkDrive sync failed for ${dealId}:`, msg);
	});
	syncProjectsForDeal(dealId).catch((err) => {
		const msg = err instanceof Error ? err.message : 'unknown';
		console.warn(`[bot/trade-sync] Projects sync failed for ${dealId}:`, msg);
	});
	syncSignForDeal(dealId).catch((err) => {
		const msg = err instanceof Error ? err.message : 'unknown';
		console.warn(`[bot/trade-sync] Sign sync failed for ${dealId}:`, msg);
	});

	return json({ ok: true, dealId, started: true });
};
