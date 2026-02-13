import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { listSignRequestsByRecipient } from '$lib/server/sign';
import type { RequestHandler } from './$types';

const DEFAULT_SIGN_BASE = 'https://sign.zoho.com/api/v1';
const ZOHO_SIGN_API_BASE = env.ZOHO_SIGN_API_BASE;

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const sessionToken = cookies.get('portal_session');
	const requestId = params.id;
	const download = url.searchParams.get('download') === '1';

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

		const requests = await listSignRequestsByRecipient(accessToken, session.client.email);
		const requestMatch = requests.find((request: any) => {
			const matchId = request.request_id || request.requestId;
			return String(matchId) === String(requestId);
		});

		if (!requestMatch) {
			throw error(403, 'No access to this contract');
		}

		const base = ZOHO_SIGN_API_BASE || DEFAULT_SIGN_BASE;
		const url = `${base}/requests/${encodeURIComponent(requestId)}/pdf`;
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Zoho-oauthtoken ${accessToken}`
			}
		});

		if (!response.ok) {
			const details = await response.text();
			throw new Error(`Zoho Sign PDF fetch failed: ${details}`);
		}

		const buffer = await response.arrayBuffer();
		const contentType = response.headers.get('content-type') || 'application/pdf';

		const headers = new Headers({
			'Content-Type': contentType.includes('pdf') ? contentType : 'application/pdf',
			'Cache-Control': 'private, no-store'
		});
		const filename = `contract-${requestId}.pdf`;
		headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);

		return new Response(buffer, {
			status: 200,
			headers
		});
	} catch (err) {
		console.error('Failed to fetch contract PDF:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch contract PDF');
	}
};
