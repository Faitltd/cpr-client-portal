import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTradeSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';

const RESOURCE_ID_PATTERN = /^[a-zA-Z0-9]+$/;
const PRIMARY_BASE_URL = 'https://download.zoho.com/v1/workdrive/download';
const FALLBACK_BASE_URL = 'https://workdrive.zoho.com/api/v1/download';

function toSafeIso(value: unknown, fallback?: unknown) {
	const date = new Date(value as any);
	if (!Number.isNaN(date.getTime())) return date.toISOString();
	if (fallback) {
		const fallbackDate = new Date(fallback as any);
		if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate.toISOString();
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
			refresh_token: tokens.refresh_token,
			expires_at: toSafeIso(refreshed.expires_at, tokens.expires_at),
			scope: tokens.scope
		});
	}

	return accessToken;
}

type FetchAttempt = {
	ok: boolean;
	status: number | null;
	body: string;
	error?: string;
	response?: Response;
};

async function attemptFetch(url: string, headers: HeadersInit): Promise<FetchAttempt> {
	try {
		const response = await fetch(url, { method: 'GET', headers });
		if (response.status === 200) {
			return { ok: true, status: response.status, body: '', response };
		}

		const text = await response.text().catch(() => '');
		return { ok: false, status: response.status, body: text.slice(0, 500) };
	} catch (err) {
		return {
			ok: false,
			status: null,
			body: '',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

function buildProxyHeaders(source: Response) {
	const headers = new Headers();
	const contentType = source.headers.get('content-type') || 'image/jpeg';
	const contentLength = source.headers.get('content-length');
	if (contentLength) headers.set('Content-Length', contentLength);
	headers.set('Content-Type', contentType);
	headers.set('Cache-Control', 'public, max-age=3600');
	headers.set('Content-Disposition', 'inline');
	return headers;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionToken = cookies.get('trade_session');
	if (!sessionToken) {
		return json({ message: 'Not authenticated' }, { status: 401 });
	}

	const session = await getTradeSession(sessionToken);
	if (!session) {
		return json({ message: 'Invalid session' }, { status: 401 });
	}

	const resourceId = String(params.resourceId || '').trim();
	if (!resourceId || !RESOURCE_ID_PATTERN.test(resourceId)) {
		return json({ error: 'Invalid resource id' }, { status: 400 });
	}

	let accessToken = '';
	try {
		accessToken = await getAccessToken();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Zoho tokens not configured';
		return json({ error: message }, { status: 500 });
	}

	const authHeader = { Authorization: `Zoho-oauthtoken ${accessToken}` };
	const primaryUrl = `${PRIMARY_BASE_URL}/${resourceId}`;
	const primary = await attemptFetch(primaryUrl, authHeader);
	if (primary.ok && primary.response) {
		return new Response(primary.response.body, {
			status: primary.response.status,
			headers: buildProxyHeaders(primary.response)
		});
	}

	const fallbackUrl = `${FALLBACK_BASE_URL}/${resourceId}`;
	const fallback = await attemptFetch(fallbackUrl, {
		...authHeader,
		Accept: 'application/octet-stream'
	});
	if (fallback.ok && fallback.response) {
		return new Response(fallback.response.body, {
			status: fallback.response.status,
			headers: buildProxyHeaders(fallback.response)
		});
	}

	console.error('[PHOTO PROXY] WorkDrive download failed', {
		resourceId,
		primaryStatus: primary.status,
		primaryBody: primary.body,
		primaryError: primary.error,
		fallbackStatus: fallback.status,
		fallbackBody: fallback.body,
		fallbackError: fallback.error
	});

	return json(
		{
			error: 'Failed to fetch photo from WorkDrive',
			primary: primary.status,
			fallback: fallback.status
		},
		{ status: 502 }
	);
};
