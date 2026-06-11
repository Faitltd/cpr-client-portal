import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import {
	createDesignerSession,
	createTradeSession,
	getDesignerAuthByEmail,
	getTradePartnerAuthByEmail
} from '$lib/server/db';
import { generateSessionToken } from '$lib/server/session-token';

const WEEK_SECONDS = 60 * 60 * 24 * 7;

/**
 * Seed designer + trade sessions for an admin's email so admin logins land on
 * the full designer dashboard (same tabs as designers, plus admin tabs).
 * Returns true when a designer session was created.
 */
export async function seedPortalSessionsForAdmin(
	cookies: Cookies,
	email: string,
	ipAddress: string | null,
	userAgent: string | null
): Promise<boolean> {
	try {
		const designer = await getDesignerAuthByEmail(email);
		if (!designer || designer.active === false) return false;

		const expiresAt = new Date(Date.now() + WEEK_SECONDS * 1000).toISOString();

		const portalToken = generateSessionToken();
		await createDesignerSession({
			session_token: portalToken,
			designer_id: designer.id,
			expires_at: expiresAt,
			ip_address: ipAddress,
			user_agent: userAgent
		});
		cookies.set('portal_session', portalToken, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			maxAge: WEEK_SECONDS
		});

		const tradePartner = await getTradePartnerAuthByEmail(email);
		if (tradePartner) {
			const tradeToken = generateSessionToken();
			await createTradeSession({
				session_token: tradeToken,
				trade_partner_id: tradePartner.id,
				expires_at: expiresAt,
				ip_address: ipAddress,
				user_agent: userAgent
			});
			cookies.set('trade_session', tradeToken, {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'strict',
				maxAge: WEEK_SECONDS
			});
		}

		return true;
	} catch (err) {
		console.error('[admin] portal session seed failed', err);
		return false;
	}
}
