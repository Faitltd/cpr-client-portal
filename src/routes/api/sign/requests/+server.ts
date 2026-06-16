import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import { buildCacheKey, getCache, setCache } from '$lib/server/api-cache';
import { createLogger } from '$lib/server/logger';
import {
	getRequestDetails,
	listSignRequestsByRecipient
} from '$lib/server/sign';
import type { RequestHandler } from './$types';

const log = createLogger('sign-requests');

async function getAccessToken() {
	const valid = await ensureValidZohoToken();
	if (!valid) {
		throw error(500, 'Zoho tokens not configured');
	}

	return valid.accessToken;
}

async function refreshSignCache(accessToken: string, email: string, cacheKey: string) {
	const requests = await listSignRequestsByRecipient(accessToken, email);
	const results = [];

	for (const request of requests) {
		const requestId = request.request_id || request.requestId;
		if (!requestId) continue;

		const details = await getRequestDetails(accessToken, requestId);
		const actions = details?.actions || [];
		const normalizedEmail = email.toLowerCase();
		// Only surface a contract if the logged-in user is actually a recipient on
		// it. Zoho's recipient_email search filter is unreliable and can return
		// the full org-wide request list, so ownership is enforced here. Without
		// this check, every client (and any internal user) sees everyone's
		// contracts.
		const isRecipient = actions.some((item: any) => {
			const recipientEmail = (item.recipient_email || item.recipientEmail || '').toLowerCase();
			return recipientEmail === normalizedEmail;
		});
		if (!isRecipient) continue;

		const action = actions.find((item: any) => {
			const actionType = (item.action_type || item.actionType || '').toLowerCase();
			const recipientEmail = (item.recipient_email || item.recipientEmail || '').toLowerCase();
			return actionType === 'sign' && recipientEmail === normalizedEmail;
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
		if (!email) {
			return json({ data: [] });
		}
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
