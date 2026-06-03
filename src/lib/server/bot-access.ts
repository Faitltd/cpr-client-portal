import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getPortalPrincipal } from '$lib/server/designer';
import { getTradeSession } from '$lib/server/db';

const ALLOWED_EMAILS = new Set(
	(env.BOT_CHAT_ALLOWED_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
);

export type BotRole = 'admin' | 'designer' | 'trade_partner' | 'client';

export interface BotAccess {
	role: BotRole;
	email: string;
	/** Sources the role may retrieve from. `null` = no source filter. */
	allowedSources: string[] | null;
	/**
	 * For WorkDrive sources only: if set, only files inside one of these
	 * deal-level subfolders (the `top_folder` recorded at sync time) are
	 * visible. `null` = no top-folder gate. Used to restrict trade partners
	 * to the "Designs" subfolder for each project.
	 */
	allowedTopFolders: string[] | null;
	/** When true, redact ALL financial fields/values (trade-partner mode). */
	hideFinancials: boolean;
	/**
	 * When true, redact INTERNAL financial values only — cost basis, sub bids,
	 * margin/markup, vendor bills, COGS, books opening balance, deal probability.
	 * The principal's own quote, allowances, invoices, payments, and balance
	 * remain visible. Used for the client (homeowner) role.
	 */
	hideInternalFinancials: boolean;
	/** Trade-partner id, used to scope Deal list to assignments. */
	tradePartnerId: string | null;
	/** Client id, used to scope Deal list to this homeowner's projects. */
	clientId: string | null;
}

/**
 * Resolve who the caller is and what they can see.
 *
 *  Admin           → all sources, full financials, every Deal.
 *  Designer        → same as admin (CPR internal).
 *  Trade-partner   → WorkDrive + Deal-field context only. No Amount.
 *                    Caller must additionally restrict the Deal list to the
 *                    partner's assignments (see /api/trade/bot/deals).
 *  Client          → Their own deal data + WorkDrive + their invoices/payments.
 *                    Internal cost basis, sub bids, margin/markup, vendor
 *                    bills, books opening balance, and probability are scrubbed.
 *                    Cliq internal channel and Books estimate cost build-ups
 *                    are excluded from retrieval entirely.
 *
 * Returns null when the caller is none of the above.
 */
export async function getBotAccess(cookies: Cookies): Promise<BotAccess | null> {
	if (isValidAdminSession(cookies.get('admin_session'))) {
		return {
			role: 'admin',
			email: 'admin',
			allowedSources: null,
			allowedTopFolders: null,
			hideFinancials: false,
			hideInternalFinancials: false,
			tradePartnerId: null,
			clientId: null
		};
	}

	// Trade session takes precedence over portal session. A user can hold both
	// cookies (e.g. CPR staff who are also added as a trade partner on a
	// project, or a trade partner who was once a homeowner client). When they
	// reach a /trade/* route, the trade-partner role is what they need.
	const tradeToken = cookies.get('trade_session');
	if (tradeToken) {
		const session = await getTradeSession(tradeToken);
		if (session && new Date(session.expires_at) > new Date()) {
			return {
				role: 'trade_partner',
				email: session.trade_partner.email ?? '',
				// WorkDrive (Designs only) + Deal-field context + external Cliq
				// channel (CPR ↔ client conversations the trade partner is
				// often part of). Internal Cliq, Mail, Books, CRM emails stay
				// excluded — they leak pricing or staff-only commentary. The
				// hideFinancials redactor below still scrubs any dollar
				// amounts that slip into the external Cliq stream.
				allowedSources: [
					'workdrive_pdf',
					'workdrive_docx',
					'workdrive_xlsx',
					'zoho_crm_field',
					'zoho_cliq_external'
				],
				// WorkDrive-side gate: only files inside each deal's "Designs"
				// subfolder are visible. SOW, Permits, Change Orders, etc. stay
				// hidden because they may carry pricing or internal-only material.
				allowedTopFolders: ['Designs'],
				hideFinancials: true,
				hideInternalFinancials: false,
				tradePartnerId: session.trade_partner.id ?? null,
				clientId: null
			};
		}
	}

	const portalToken = cookies.get('portal_session');
	if (portalToken) {
		const principal = await getPortalPrincipal(portalToken);
		if (principal?.role === 'designer') {
			const normalized = (principal.session.designer.email ?? '').toLowerCase();
			if (normalized && ALLOWED_EMAILS.has(normalized)) {
				return {
					role: 'designer',
					email: normalized,
					allowedSources: null,
					allowedTopFolders: null,
					hideFinancials: false,
					hideInternalFinancials: false,
					tradePartnerId: null,
					clientId: null
				};
			}
		}
		if (principal?.role === 'client') {
			const client = principal.session.client;
			return {
				role: 'client',
				email: (client.email ?? '').toLowerCase(),
				// Homeowner-visible sources only. Books estimates expose CPR's
				// cost build-up (line-item margins), so they're excluded. Cliq
				// internal is staff-only. Mail is excluded by default because
				// it routinely contains internal pricing discussions; if you
				// want clients to see their own client-facing email, switch
				// the retrieve layer to filter by recipient first.
				allowedSources: [
					'workdrive_pdf',
					'workdrive_docx',
					'workdrive_xlsx',
					'zoho_crm_field',
					'zoho_books_invoice',
					'zoho_books_payment',
					'zoho_cliq_external',
					'transcript'
				],
				// WorkDrive-side gate: clients see only files inside their
				// deal's "Client Portal" subfolder. Designs, SOW, Permits,
				// Internal, Cost Build-ups, etc. all stay hidden because they
				// may carry pre-markup pricing or staff-only material.
				// (zoho_cliq_internal is already excluded above; only the
				// external client-facing Cliq channel reaches them.)
				allowedTopFolders: ['Client Portal'],
				hideFinancials: false,
				hideInternalFinancials: true,
				tradePartnerId: null,
				clientId: client.id ?? null
			};
		}
	}

	return null;
}
