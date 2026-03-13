import { json } from '@sveltejs/kit';
import {
	createFieldUpdate,
	getTradeSession,
	getZohoTokens,
	supabase,
	upsertZohoTokens
} from '$lib/server/db';
import { getTradePartnerDeals } from '$lib/server/auth';
import { refreshAccessToken } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const VALID_UPDATE_TYPES = new Set([
	'progress',
	'issue',
	'material_delivery',
	'inspection',
	'weather_delay',
	'schedule_change',
	'completed_work',
	'other'
]);

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
	return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw new Error('Zoho tokens not configured');
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

	return accessToken;
}

async function isDealAuthorizedForTradePartner(dealId: string) {
	const accessToken = await getAccessToken();
	const dealList = await getTradePartnerDeals(accessToken);
	return dealList.some((deal: any) => String(deal?.id || '') === dealId);
}

export const POST: RequestHandler = async ({ cookies, request }) => {
	const token = cookies.get('trade_session');
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const session = await getTradeSession(token);
		if (!session || new Date(session.expires_at) < new Date()) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json().catch(() => ({}));
		const dealId = String(body?.deal_id || '').trim();
		const updateType = String(body?.update_type || '').trim();
		const note = typeof body?.note === 'string' ? body.note.trim() : null;
		const photoIds = body?.photo_ids;

		if (!dealId) {
			return json({ error: 'Missing required field: deal_id' }, { status: 400 });
		}
		if (!updateType) {
			return json({ error: 'Missing required field: update_type' }, { status: 400 });
		}
		if (!VALID_UPDATE_TYPES.has(updateType)) {
			return json(
				{
					error:
						'Invalid update_type. Must be one of: progress, issue, material_delivery, inspection, weather_delay, schedule_change, completed_work, other'
				},
				{ status: 400 }
			);
		}
		if (
			photoIds !== undefined &&
			photoIds !== null &&
			(!Array.isArray(photoIds) || !photoIds.every((item: unknown) => typeof item === 'string'))
		) {
			return json({ error: 'Invalid photo_ids. Must be an array of strings' }, { status: 400 });
		}

		if (!session.trade_partner?.zoho_trade_partner_id) {
			return json({ error: 'Trade partner is missing Zoho ID' }, { status: 400 });
		}

		const authorized = await isDealAuthorizedForTradePartner(dealId);
		if (!authorized) {
			return json({ error: 'Deal not authorized for this trade partner' }, { status: 403 });
		}

		const created = await createFieldUpdate({
			deal_id: dealId,
			trade_partner_id: session.trade_partner_id,
			update_type: updateType,
			note: note || null,
			photo_ids: photoIds ?? null
		});

		let photo_urls: string[] | null = null;
		if (created.photo_ids?.length) {
			photo_urls = created.photo_ids.map(
				(id: string) => supabase.storage.from('trade-photos').getPublicUrl(id).data.publicUrl
			);
		}

		return json({ data: { ...created, photo_urls } }, { status: 201 });
	} catch (err) {
		console.error('Failed to create field update:', err);
		return json({ error: 'Failed to create field update' }, { status: 500 });
	}
};
