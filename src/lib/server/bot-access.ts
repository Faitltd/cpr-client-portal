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

export type BotRole = 'admin' | 'designer' | 'trade_partner';

export interface BotAccess {
	role: BotRole;
	email: string;
	/** Sources the role may retrieve from. `null` = no source filter. */
	allowedSources: string[] | null;
	/** When true, redact financial fields (Amount) from Deal context. */
	hideFinancials: boolean;
	/** Trade-partner id, used to scope Deal list to assignments. */
	tradePartnerId: string | null;
}

/**
 * Resolve who the caller is and what they can see.
 *
 *  Admin           → all sources, full financials, every Deal.
 *  Designer        → same as admin (CPR internal).
 *  Trade-partner   → WorkDrive + Deal-field context only. No Amount.
 *                    Caller must additionally restrict the Deal list to the
 *                    partner's assignments (see /api/trade/bot/deals).
 *
 * Returns null when the caller is none of the above.
 */
export async function getBotAccess(cookies: Cookies): Promise<BotAccess | null> {
	if (isValidAdminSession(cookies.get('admin_session'))) {
		return {
			role: 'admin',
			email: 'admin',
			allowedSources: null,
			hideFinancials: false,
			tradePartnerId: null
		};
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
					hideFinancials: false,
					tradePartnerId: null
				};
			}
		}
	}

	const tradeToken = cookies.get('trade_session');
	if (tradeToken) {
		const session = await getTradeSession(tradeToken);
		if (session && new Date(session.expires_at) > new Date()) {
			return {
				role: 'trade_partner',
				email: session.trade_partner.email ?? '',
				// Only non-financial sources. WorkDrive + Deal-field context.
				// Books/Mail/CRM-emails/Cliq all excluded — could surface pricing
				// or internal commentary that shouldn't reach trade partners.
				allowedSources: ['workdrive_pdf', 'workdrive_docx', 'zoho_crm_field'],
				hideFinancials: true,
				tradePartnerId: session.trade_partner.id ?? null
			};
		}
	}

	return null;
}
