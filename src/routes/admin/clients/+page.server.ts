import { fail, redirect } from '@sveltejs/kit';
import {
	debugTradePartnerRecord,
	listContactsForActiveDeals,
	listTradePartnersWithStats
} from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import { isValidAdminSession } from '$lib/server/admin';
import {
	clearClients,
	getZohoTokens,
	listClients,
	setClientPassword,
	setTradePartnerPassword,
	upsertClient,
	upsertTradePartner,
	upsertZohoTokens
} from '$lib/server/db';
import { hashPassword } from '$lib/server/password';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(session: string | undefined) {
	if (!isValidAdminSession(session)) {
		throw redirect(302, '/admin/login');
	}
}

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) {
		return date.toISOString();
	}
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.toISOString();
		}
	}
	// Short expiry to force a refresh soon if Zoho returned an invalid date.
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

export const load: PageServerLoad = async ({ cookies }) => {
	requireAdmin(cookies.get('admin_session'));
	const clients = await listClients();
	const { data: tradePartners, error: tradeError } = await import('$lib/server/db').then((m) =>
		m.supabase
			.from('trade_partners')
			.select('id, email, name')
			.order('name', { ascending: true, nullsFirst: false })
			.order('email', { ascending: true })
	);
	if (tradeError) {
		throw new Error(`Trade partner list failed: ${tradeError.message}`);
	}
	const sorted = [...clients].sort((a, b) => {
		const aName = (a.full_name || a.email || '').toLowerCase();
		const bName = (b.full_name || b.email || '').toLowerCase();
		return aName.localeCompare(bName);
	});
	return { clients: sorted, tradePartners: tradePartners || [] };
};

export const actions: Actions = {
	setPassword: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const clientId = String(form.get('client_id') || '');
		const password = String(form.get('password') || '');

		if (!clientId) {
			return fail(400, { message: 'Select a client.' });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		await setClientPassword(clientId, hashPassword(password));
		return { message: 'Password updated.' };
	},
	setTradePassword: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const tradeId = String(form.get('trade_partner_id') || '');
		const password = String(form.get('password') || '');

		if (!tradeId) {
			return fail(400, { message: 'Select a trade partner.' });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		await setTradePartnerPassword(tradeId, hashPassword(password));

		return { message: 'Trade partner password updated.' };
	},
	sync: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		try {
			const tokens = await getZohoTokens();
			if (!tokens) {
				return fail(500, { message: 'Zoho is not connected yet.' });
			}

			await clearClients();

			let accessToken = tokens.access_token;
			if (new Date(tokens.expires_at) < new Date()) {
				const refreshed = await refreshAccessToken(tokens.refresh_token);
				accessToken = refreshed.access_token;
				await upsertZohoTokens({
					user_id: tokens.user_id,
					access_token: refreshed.access_token,
					refresh_token: refreshed.refresh_token,
					expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
					scope: tokens.scope
				});
			}

			let synced = 0;
			let errors = 0;
			const contacts = await listContactsForActiveDeals(accessToken);
			const seenEmails = new Set<string>();
			for (const contact of contacts) {
				const email = contact.email?.toLowerCase();
				if (!email) continue;
				if (seenEmails.has(email)) {
					errors += 1;
					console.warn(`Duplicate email skipped: ${email}`);
					continue;
				}
				seenEmails.add(email);
				try {
					await upsertClient(contact);
					synced += 1;
				} catch (err) {
					errors += 1;
					console.error('Failed to sync contact', contact.email, err);
				}
			}

			const message = errors
				? `Synced ${synced} contacts. ${errors} failed.`
				: `Synced ${synced} contacts.`;

			return { message };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error('Client sync failed', err);
			return fail(500, { message: `Client sync failed: ${message}` });
		}
	},
	syncTradePartners: async ({ cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const tokens = await getZohoTokens();
		if (!tokens) {
			return fail(500, { message: 'Zoho is not connected yet.' });
		}

		let accessToken = tokens.access_token;
		if (new Date(tokens.expires_at) < new Date()) {
			const refreshed = await refreshAccessToken(tokens.refresh_token);
			accessToken = refreshed.access_token;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: refreshed.refresh_token,
				expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
				scope: tokens.scope
			});
		}

		let synced = 0;
		let errors = 0;
		const { partners, stats } = await listTradePartnersWithStats(accessToken);
		for (const partner of partners) {
			try {
				await upsertTradePartner(partner);
				synced += 1;
			} catch (err) {
				errors += 1;
				console.error('Failed to sync trade partner', partner.email, err);
			}
		}

		const totalRecords = stats.reduce((sum, stat) => sum + stat.totalRecords, 0);
		const missingEmail = stats.reduce((sum, stat) => sum + stat.missingEmail, 0);
		const recovered = stats.reduce((sum, stat) => sum + (stat.recovered || 0), 0);
		const moduleSummary =
			stats.length > 1
				? ` Modules: ${stats.map((stat) => `${stat.moduleName}=${stat.totalRecords}`).join(', ')}.`
				: stats.length === 1
					? ` Module: ${stats[0].moduleName}.`
					: '';
		const baseMessage = errors
			? `Synced ${synced} trade partners. ${errors} failed.`
			: `Synced ${synced} trade partners.`;
		const message =
			stats.length > 0
				? `${baseMessage} Zoho returned ${totalRecords} records. Missing email: ${missingEmail}. Recovered: ${recovered}.${moduleSummary}`
				: baseMessage;

		return { message };
	},
	debugTradePartner: async ({ request, cookies }) => {
		requireAdmin(cookies.get('admin_session'));
		const form = await request.formData();
		const zohoId = String(form.get('zoho_trade_partner_id') || '').trim();
		if (!zohoId) {
			return fail(400, { message: 'Enter a Zoho trade partner ID.' });
		}

		const tokens = await getZohoTokens();
		if (!tokens) {
			return fail(500, { message: 'Zoho is not connected yet.' });
		}

		let accessToken = tokens.access_token;
		if (new Date(tokens.expires_at) < new Date()) {
			const refreshed = await refreshAccessToken(tokens.refresh_token);
			accessToken = refreshed.access_token;
			await upsertZohoTokens({
				user_id: tokens.user_id,
				access_token: refreshed.access_token,
				refresh_token: refreshed.refresh_token,
				expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
				scope: tokens.scope
			});
		}

		const debug = await debugTradePartnerRecord(accessToken, zohoId);
		if (!debug) {
			return { message: `Debug ${zohoId}: no record returned by the API.` };
		}

		const emailValue = debug.email ? debug.email : 'missing';
		const emailFields = debug.emailFields.length ? debug.emailFields.join(', ') : 'none';
		const keys = debug.keys.slice(0, 20).join(', ');
		const message = `Debug ${zohoId} (${debug.moduleName}): email=${emailValue}. Email fields: ${emailFields}. Keys: ${keys}.`;
		return { message };
	}
};
