import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { buildCacheKey, getCache, setCache } from '$lib/server/api-cache';
import { createLogger } from '$lib/server/logger';
import {
	getRequestDetails,
	listSignRequestsByRecipient
} from '$lib/server/sign';
import type { RequestHandler } from './$types';

const log = createLogger('sign-requests');

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) {
		throw error(500, 'Zoho tokens not configured');
	}

	let accessToken = tokens.access_token;
	if (new Date(tokens.expires_at) < new Date()) {
		const newTokens = await refreshAccessToken(tokens.refresh_token);
		accessToken = newTokens.access_token;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: newTokens.access_token,
			refresh_token: newTokens.refresh_token,
			expires_at: new Date(newTokens.expires_at).toISOString(),
			scope: tokens.scope
		});
	}

	return accessToken;
}

async function refreshSignCache(accessToken: string, email: string, cacheKey: string) {
	const requests = await listSignRequestsByRecipient(accessToken, email);
	const results = [];

	for (const request of requests) {
		const requestId = request.request_id || request.requestId;
		if (!requestId) continue;

		const details = await getRequestDetails(accessToken, requestId);
		const actions = details?.actions || [];
		const action = actions.find((item: any) => {
			const actionType = (item.action_type || item.actionType || '').toLowerCase();
			const recipientEmail = (item.recipient_email || item.recipientEmail || '').toLowerCase();
			return actionType === 'sign' && recipientEmail === email.toLowerCase();
		});

		const name =
			details?.request_name ||
			request.request_name ||
			request.request_name_display ||
			request.requestname ||
			'Contract';
		const status =
			details?.request_status || request.request_status || request.status || 'Unknown';
		if (String(status).toLowerCase().includes('expired')) {
			continue;
		}
		const viewUrl =
			details?.document_url ||
			details?.request_url ||
			request.document_url ||
			request.request_url ||
			null;

		results.push({
			id: requestId,
			name,
			status,
			can_sign: Boolean(action),
			view_url: viewUrl
		});
	}

	const payload = { data: results };
	await setCache(cacheKey, payload, { staleSec: 120, expireSec: 600 });
	return payload;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	try {
		const session = await getSession(sessionToken);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		const email = String(session.client.email || '').toLowerCase();
		const cacheKey = buildCacheKey('sign-requests', email);
		const cached = await getCache(cacheKey);
		if (cached) {
			log.info('API response cache hit', { cacheKey, stale: cached.isStale });
			if (cached.isStale) {
				try {
					const accessToken = await getAccessToken();
					refreshSignCache(accessToken, email, cacheKey).catch(() => {});
				} catch {}
			}
			return json(cached.data);
		}

		const accessToken = await getAccessToken();
		const fresh = await refreshSignCache(accessToken, email, cacheKey);
		return json(fresh);
	} catch (err) {
		console.error('Failed to fetch contracts:', err);
		throw error(500, 'Failed to fetch contracts');
	}
};
