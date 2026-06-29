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
	/**
	 * For WorkDrive sources only: drop any file whose Subject (filename)
	 * matches any of these regex patterns (string form, compiled at use).
	 * Used to block files like "Guikema_BP_Partial Kitchen" — BP = Ballpark
	 * Pricing — even when they live in an otherwise-allowed folder.
	 */
	blockedSubjectPatterns?: string[] | null;
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
	/**
	 * Zoho CRM Contact id for the client. The portal `clientId` is the
	 * portal-side record id; `getDealsForClient` actually keys off the Zoho
	 * Contact id (plus email as a fallback), so we carry it separately.
	 */
	clientZohoContactId?: string | null;
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

	// Internal designer (CPR staff) takes precedence over a trade_session.
	// CPR staff are sometimes ALSO registered as trade partners (e.g. a lead
	// carpenter), so they can hold both a portal_session and a trade_session.
	// Their internal identity must win — otherwise the trade cookie downgrades
	// them to trade-partner filtering (no financials) on internal endpoints.
	// Only whitelisted designer emails are elevated here; genuine external
	// trade partners (not in ALLOWED_EMAILS) fall through to the trade branch.
	{
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
		}
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
				// often part of) + project task status.
				//
				// Excluded entirely:
				//   - zoho_mail / zoho_cliq_internal — leak pricing + staff chat
				//   - zoho_books_* — estimates, invoices, payments
				//   - zoho_sign_request — signed contracts include pricing
				//   - workdrive_* outside `Designs` — blocks Contracts and
				//     Agreements (Estimates, Bids, PDA all hold pricing)
				//
				// hideFinancials below is the belt-and-suspenders pass that
				// scrubs any dollar amount that slips through any source.
				allowedSources: [
					'workdrive_pdf',
					'workdrive_docx',
					'workdrive_xlsx',
					'zoho_crm_field',
					'zoho_cliq_external',
					'zoho_projects_task',
					'zoho_projects_activity',
					// Crew schedule — internal staff + trades may see who's on
					// site and when. Clients are NOT granted this source.
					'cpr_shift'
				],
				// WorkDrive-side gate: ONLY the Designs subfolder family. This
				// hides Contracts and Agreements (where Estimates / Bids / PDA
				// all carry pricing) and Job Costing. The actual trade scope
				// CPR puts in Designs/SOW is still reachable here.
				allowedTopFolders: ['Designs', 'Design', 'Design & Planning'],
				// Filename gate: also block ballpark estimates, bids, quotes,
				// pricing files even when they appear in the Designs folder
				// (e.g. "Guikema_BP_Partial Kitchen" — BP = Ballpark Pricing
				// — lives in Designs/Notes and Breakdowns).
				blockedSubjectPatterns: [
					'(^|[\\s_\\-\\.])bp([\\s_\\-\\.]|$)',
					'ballpark',
					'estimate',
					'\\bbid\\b',
					'\\bbids\\b',
					'\\bquote\\b',
					'pricing',
					'\\$\\d',
					'job\\s*cost',
					'breakdown',
					'reconciliation',
					'agreement',
					'contract',
					'(^|[\\s_\\-\\.])pda([\\s_\\-\\.]|$)',
					'project\\s*development',
					'completion\\s*certificate'
				],
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
			return buildClientBotAccess(principal.session.client as Record<string, any>);
		}
	}

	return null;
}

/**
 * Build the homeowner (client) bot access object from a client record. Exposed
 * so the client-facing endpoints can resolve a client directly from the portal
 * session — independent of getBotAccess's admin→trade→portal precedence, which
 * would otherwise let a stale trade/admin cookie shadow a real client session.
 */
export function buildClientBotAccess(client: Record<string, any>): BotAccess {
	return {
		role: 'client',
		email: (client.email ?? '').toLowerCase(),
		// Homeowner-visible sources only. Books estimates expose CPR's cost
		// build-up (line-item margins), so they're excluded. Cliq internal is
		// staff-only. Mail is excluded by default because it routinely contains
		// internal pricing discussions.
		allowedSources: [
			'workdrive_pdf',
			'workdrive_docx',
			'workdrive_xlsx',
			'zoho_crm_field',
			'zoho_books_invoice',
			'zoho_books_payment',
			'zoho_cliq_external',
			'zoho_projects_task',
			'zoho_projects_activity',
			'zoho_sign_request',
			'transcript'
		],
		// WorkDrive-side gate: clients see only files inside their deal's
		// "Client Portal" subfolder.
		allowedTopFolders: ['Client Portal'],
		hideFinancials: false,
		hideInternalFinancials: true,
		tradePartnerId: null,
		clientId: client.id ?? null,
		clientZohoContactId: client.zoho_contact_id ?? client.zohoContactId ?? null
	};
}
