import { json, error } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import {
	getEmbedToken,
	getRequestDetails,
	listSignRequestsByRecipient
} from '$lib/server/sign';
import type { RequestHandler } from './$types';

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

		const requests = await listSignRequestsByRecipient(accessToken, session.client.email);
		const results = [];

		for (const request of requests) {
			const requestId = request.request_id || request.requestId;
			if (!requestId) continue;

			const details = await getRequestDetails(accessToken, requestId);
			const actions = details?.actions || [];
			const action = actions.find((item: any) => {
				const actionType = (item.action_type || item.actionType || '').toLowerCase();
				const email = (item.recipient_email || item.recipientEmail || '').toLowerCase();
				return actionType === 'sign' && email === session.client.email.toLowerCase();
			});

			const signUrl = action
				? await getEmbedToken(accessToken, requestId, action.action_id || action.actionId)
				: null;

			results.push({
				id: requestId,
				name: request.request_name || request.request_name_display || request.requestname || 'Contract',
				status: request.request_status || request.status || 'Unknown',
				sign_url: signUrl,
				view_url: request.document_url || request.request_url || null
			});
		}

		return json({ data: results });
	} catch (err) {
		console.error('Failed to fetch contracts:', err);
		throw error(500, 'Failed to fetch contracts');
	}
};
