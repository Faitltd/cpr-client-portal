import { json, error, redirect } from '@sveltejs/kit';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { getEmbedToken, getRequestDetails, listSignRequestsByRecipient } from '$lib/server/sign';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const sessionToken = cookies.get('portal_session');
	const requestId = params.id;

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	if (!requestId) {
		throw error(400, 'Request ID required');
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

		const details = await getRequestDetails(accessToken, requestId);
		if (!details) {
			throw error(404, 'Contract not found');
		}

		const actions = details?.actions || [];
		const action = actions.find((item: any) => {
			const actionType = (item.action_type || item.actionType || '').toLowerCase();
			const email = (item.recipient_email || item.recipientEmail || '').toLowerCase();
			return actionType === 'sign' && email === session.client.email.toLowerCase();
		});

		if (!action) {
			throw error(403, 'No signing action available for this contract');
		}

		const actionId = action.action_id || action.actionId;
		if (!actionId) {
			throw error(500, 'Signing action missing');
		}

		const directSignUrl =
			action.action_url ||
			action.actionUrl ||
			action.sign_url ||
			action.signUrl ||
			action.signing_url ||
			action.signingUrl ||
			null;

		let signUrl = directSignUrl;
		if (!signUrl) {
			const requests = await listSignRequestsByRecipient(accessToken, session.client.email);
			const requestMatch = requests.find((request: any) => {
				const matchId = request.request_id || request.requestId;
				return String(matchId) === String(requestId);
			});
			signUrl =
				requestMatch?.request_url ||
				requestMatch?.requestUrl ||
				requestMatch?.action_url ||
				requestMatch?.actionUrl ||
				requestMatch?.sign_url ||
				requestMatch?.signUrl ||
				requestMatch?.signing_url ||
				requestMatch?.signingUrl ||
				null;
		}
		if (!signUrl) {
			const signPayload = await getEmbedToken(accessToken, requestId, actionId);
			signUrl =
				typeof signPayload === 'string'
					? signPayload
					: signPayload?.signing_url || signPayload?.sign_url || null;
		}

		if (!signUrl) {
			throw error(500, 'Signing URL not available');
		}

		if (url.searchParams.get('redirect') === '1') {
			throw redirect(302, signUrl);
		}

		return json({
			data: {
				id: requestId,
				name:
					details.request_name ||
					details.request_name_display ||
					details.requestname ||
					'Contract',
				status: details.request_status || details.status || 'Unknown',
				sign_url: signUrl
			}
		});
	} catch (err) {
		console.error('Failed to fetch signing URL:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch signing URL');
	}
};
