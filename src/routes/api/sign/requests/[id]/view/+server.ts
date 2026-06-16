import { json, error, redirect } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
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

		const valid = await ensureValidZohoToken();
		if (!valid) {
			throw error(500, 'Zoho tokens not configured');
		}

		const accessToken = valid.accessToken;

		const requests = await listSignRequestsByRecipient(accessToken, session.client.email);
		const requestMatch = requests.find((request: any) => {
			const matchId = request.request_id || request.requestId;
			return String(matchId) === String(requestId);
		});

		if (!requestMatch) {
			throw error(403, 'No access to this contract');
		}

		let details: any = null;
		try {
			details = await getRequestDetails(accessToken, requestId);
		} catch (err) {
			console.warn('Failed to fetch request details, using list data', err);
		}

		const actions = details?.actions || [];
		const normalizedEmail = session.client.email.toLowerCase();
		const action = actions.find((item: any) => {
			const email = (item.recipient_email || item.recipientEmail || item.email || '').toLowerCase();
			return email === normalizedEmail;
		});

		let viewUrl: string | null = null;
		const actionId = action?.action_id || action?.actionId;
		if (actionId) {
			try {
				const embedPayload = await getEmbedToken(accessToken, requestId, actionId);
				viewUrl =
					typeof embedPayload === 'string'
						? embedPayload
						: embedPayload?.signing_url || embedPayload?.sign_url || null;
			} catch (err) {
				console.warn('Failed to fetch embed token, falling back to request URL', err);
			}
		}

		if (!viewUrl) {
			viewUrl =
				details?.document_url ||
				details?.request_url ||
				details?.requestUrl ||
				details?.documents?.[0]?.document_url ||
				requestMatch.document_url ||
				requestMatch.request_url ||
				requestMatch.requestUrl ||
				null;
		}

		if (!viewUrl) {
			throw error(500, 'View link not available');
		}

		if (url.searchParams.get('redirect') === '1') {
			throw redirect(302, viewUrl);
		}

		return json({
			data: {
				id: requestId,
				name:
					details?.request_name ||
					details?.request_name_display ||
					details?.requestname ||
					requestMatch.request_name ||
					requestMatch.request_name_display ||
					requestMatch.requestname ||
					'Contract',
				status:
					details?.request_status ||
					details?.status ||
					requestMatch.request_status ||
					requestMatch.status ||
					'Unknown',
				view_url: viewUrl
			}
		});
	} catch (err) {
		console.error('Failed to fetch contract view link:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch contract view link');
	}
};
