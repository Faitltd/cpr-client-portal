import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { listSignRequestsByRecipient, getRequestDetails } from '$lib/server/sign';
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

	console.log('[SIGN PDF] Request received', { requestId });

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

		// Try the per-document PDF endpoint first (more reliable for completed docs),
		// then fall back to the request-level PDF endpoint.
		let pdfResponse: Response | null = null;

		// Attempt to get document IDs from request details
		let details: any = null;
		try {
			details = await getRequestDetails(accessToken, requestId);
		} catch (err) {
			console.warn('[SIGN PDF] Could not fetch request details, will use request-level PDF endpoint', err);
		}

		const documents = details?.document_ids || details?.documents || [];
		const firstDocId = documents[0]?.document_id || documents[0]?.documentId;

		if (firstDocId) {
			const docUrl = `${base}/requests/${encodeURIComponent(requestId)}/documents/${encodeURIComponent(firstDocId)}/pdf`;
			console.log('[SIGN PDF] Trying per-document PDF endpoint', { url: docUrl });
			const docRes = await fetch(docUrl, {
				method: 'GET',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
				redirect: 'follow'
			});
			console.log('[SIGN PDF] Per-document response', {
				status: docRes.status,
				contentType: docRes.headers.get('content-type'),
				contentLength: docRes.headers.get('content-length')
			});
			if (docRes.ok) {
				pdfResponse = docRes;
			} else {
				const errBody = await docRes.text();
				console.warn('[SIGN PDF] Per-document PDF endpoint failed, falling back', {
					status: docRes.status,
					body: errBody.slice(0, 500)
				});
			}
		}

		// Fall back to the request-level PDF endpoint
		if (!pdfResponse) {
			const reqUrl = `${base}/requests/${encodeURIComponent(requestId)}/pdf`;
			console.log('[SIGN PDF] Trying request-level PDF endpoint', { url: reqUrl });
			pdfResponse = await fetch(reqUrl, {
				method: 'GET',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
				redirect: 'follow'
			});
			console.log('[SIGN PDF] Request-level response', {
				status: pdfResponse.status,
				contentType: pdfResponse.headers.get('content-type'),
				contentLength: pdfResponse.headers.get('content-length')
			});
		}

		if (!pdfResponse.ok) {
			const errBody = await pdfResponse.text();
			console.error('[SIGN PDF] Zoho Sign PDF fetch failed', {
				requestId,
				status: pdfResponse.status,
				contentType: pdfResponse.headers.get('content-type'),
				body: errBody.slice(0, 500)
			});
			throw new Error(`Zoho Sign PDF fetch failed (${pdfResponse.status}): ${errBody.slice(0, 200)}`);
		}

		const buffer = await pdfResponse.arrayBuffer();
		const contentType = pdfResponse.headers.get('content-type') || 'application/pdf';

		console.log('[SIGN PDF] Success', {
			requestId,
			contentType,
			bodySize: buffer.byteLength
		});

		// Verify we actually got PDF bytes (PDF files start with %PDF)
		if (buffer.byteLength > 4) {
			const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 5)));
			if (!header.startsWith('%PDF')) {
				const preview = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 500)));
				console.error('[SIGN PDF] Response is NOT a PDF', {
					requestId,
					header,
					preview: preview.slice(0, 500)
				});
			}
		}

		const filename = `contract-${requestId}.pdf`;
		return new Response(buffer, {
			status: 200,
			headers: {
				'Content-Type': contentType.includes('pdf') ? contentType : 'application/pdf',
				'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
				'Content-Length': String(buffer.byteLength),
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (err) {
		console.error('[SIGN PDF] Failed to fetch contract PDF:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch contract PDF');
	}
};
