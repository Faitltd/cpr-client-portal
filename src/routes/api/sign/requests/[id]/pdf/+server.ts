import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSession, getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken } from '$lib/server/zoho';
import { listSignRequestsByRecipient, getRequestDetails } from '$lib/server/sign';
import { inflateRawSync } from 'node:zlib';
import type { RequestHandler } from './$types';

const DEFAULT_SIGN_BASE = 'https://sign.zoho.com/api/v1';
const ZOHO_SIGN_API_BASE = env.ZOHO_SIGN_API_BASE;

/**
 * Extract the first PDF from a ZIP buffer using zero dependencies.
 * Parses the Central Directory at the end of the ZIP (which always has correct sizes,
 * even when local file headers use data descriptors with compressedSize=0).
 */
function extractFirstPdfFromZip(buffer: Buffer): { data: Buffer; filename: string } | null {
	// Check ZIP signature
	if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;

	// Find End of Central Directory record (searches backwards for PK\x05\x06)
	let eocdOffset = -1;
	for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 65557; i--) {
		if (
			buffer[i] === 0x50 &&
			buffer[i + 1] === 0x4b &&
			buffer[i + 2] === 0x05 &&
			buffer[i + 3] === 0x06
		) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset === -1) return null;

	const cdOffset = buffer.readUInt32LE(eocdOffset + 16); // Central directory offset
	const cdEntries = buffer.readUInt16LE(eocdOffset + 10); // Total entries

	// Walk central directory entries (signature PK\x01\x02)
	let offset = cdOffset;
	for (let i = 0; i < cdEntries && offset < buffer.length - 46; i++) {
		if (
			buffer[offset] !== 0x50 ||
			buffer[offset + 1] !== 0x4b ||
			buffer[offset + 2] !== 0x01 ||
			buffer[offset + 3] !== 0x02
		) {
			break;
		}

		const compressionMethod = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const filenameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);
		const filename = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);

		console.log('[SIGN-PDF] Central directory entry:', {
			filename,
			compressionMethod,
			compressedSize,
			uncompressedSize,
			localHeaderOffset
		});

		if (filename.toLowerCase().endsWith('.pdf')) {
			// Read local file header to find where data starts
			const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
			const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
			const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;

			console.log('[SIGN-PDF] Extracting PDF:', { dataStart, compressedSize, uncompressedSize });

			const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

			let pdfData: Buffer;
			if (compressionMethod === 0) {
				pdfData = Buffer.from(compressedData);
			} else if (compressionMethod === 8) {
				pdfData = inflateRawSync(compressedData);
			} else {
				console.log('[SIGN-PDF] Unknown compression method:', compressionMethod);
				return null;
			}

			console.log('[SIGN-PDF] Extracted PDF successfully:', {
				size: pdfData.length,
				startsWithPDF: pdfData.toString('ascii', 0, 4) === '%PDF'
			});
			return { data: pdfData, filename };
		}

		// Move to next central directory entry
		offset += 46 + filenameLength + extraLength + commentLength;
	}

	return null;
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	console.log('[SIGN-PDF] Handler v3 invoked');

	const sessionToken = cookies.get('portal_session');
	const requestId = params.id;
	const download = url.searchParams.get('download') === '1';

	if (!sessionToken) {
		throw error(401, 'Not authenticated');
	}

	if (!requestId) {
		throw error(400, 'Request ID required');
	}

	console.log('[SIGN-PDF] Request received', { requestId });

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
			console.warn(
				'[SIGN-PDF] Could not fetch request details, will use request-level PDF endpoint',
				err
			);
		}

		const documents = details?.document_ids || details?.documents || [];
		const firstDocId = documents[0]?.document_id || documents[0]?.documentId;

		if (firstDocId) {
			const docUrl = `${base}/requests/${encodeURIComponent(requestId)}/documents/${encodeURIComponent(firstDocId)}/pdf`;
			console.log('[SIGN-PDF] Trying per-document PDF endpoint', { url: docUrl });
			const docRes = await fetch(docUrl, {
				method: 'GET',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
				redirect: 'follow'
			});
			console.log('[SIGN-PDF] Per-document response', {
				status: docRes.status,
				contentType: docRes.headers.get('content-type'),
				contentLength: docRes.headers.get('content-length')
			});
			if (docRes.ok) {
				pdfResponse = docRes;
			} else {
				const errBody = await docRes.text();
				console.warn('[SIGN-PDF] Per-document PDF endpoint failed, falling back', {
					status: docRes.status,
					body: errBody.slice(0, 500)
				});
			}
		}

		// Fall back to the request-level PDF endpoint
		if (!pdfResponse) {
			const reqUrl = `${base}/requests/${encodeURIComponent(requestId)}/pdf`;
			console.log('[SIGN-PDF] Trying request-level PDF endpoint', { url: reqUrl });
			pdfResponse = await fetch(reqUrl, {
				method: 'GET',
				headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
				redirect: 'follow'
			});
			console.log('[SIGN-PDF] Request-level response', {
				status: pdfResponse.status,
				contentType: pdfResponse.headers.get('content-type'),
				contentLength: pdfResponse.headers.get('content-length')
			});
		}

		if (!pdfResponse.ok) {
			const errBody = await pdfResponse.text();
			console.error('[SIGN-PDF] Zoho Sign PDF fetch failed', {
				requestId,
				status: pdfResponse.status,
				contentType: pdfResponse.headers.get('content-type'),
				body: errBody.slice(0, 500)
			});
			throw new Error(
				`Zoho Sign PDF fetch failed (${pdfResponse.status}): ${errBody.slice(0, 200)}`
			);
		}

		const buffer = await pdfResponse.arrayBuffer();
		const contentType = pdfResponse.headers.get('content-type') || 'application/pdf';
		const bytes = Buffer.from(buffer);

		console.log('[SIGN-PDF] Response received:', {
			contentType,
			bodySize: bytes.length
		});
		console.log(
			'[SIGN-PDF] First 4 bytes:',
			bytes.length >= 4
				? `0x${bytes[0].toString(16).padStart(2, '0')} 0x${bytes[1].toString(16).padStart(2, '0')} 0x${bytes[2].toString(16).padStart(2, '0')} 0x${bytes[3].toString(16).padStart(2, '0')}`
				: '(too short)'
		);

		// Zoho Sign may return a ZIP containing the PDF instead of a raw PDF.
		// Detect ZIP by magic bytes (PK\x03\x04) or content-type.
		const isZip =
			(bytes.length >= 4 &&
				bytes[0] === 0x50 &&
				bytes[1] === 0x4b &&
				bytes[2] === 0x03 &&
				bytes[3] === 0x04) ||
			contentType.toLowerCase().includes('zip');

		let pdfBuffer: Buffer;
		let filename: string;

		if (isZip) {
			console.log('[SIGN-PDF] ZIP detected, extracting...', { requestId });
			const result = extractFirstPdfFromZip(bytes);

			if (!result) {
				console.error('[SIGN-PDF] No PDF found inside ZIP', { requestId });
				throw new Error('Zoho Sign returned a ZIP file but no PDF was found inside');
			}

			pdfBuffer = result.data;
			filename = result.filename.replace(/^.*\//, '') || `contract-${requestId}.pdf`;
			console.log('[SIGN-PDF] Extracted PDF:', {
				filename,
				size: pdfBuffer.length
			});
		} else {
			console.log('[SIGN-PDF] Not a ZIP, serving raw response');
			pdfBuffer = bytes;
			filename = `contract-${requestId}.pdf`;

			// Verify we actually got PDF bytes (PDF files start with %PDF)
			if (bytes.length > 4) {
				const header = bytes.toString('utf8', 0, 5);
				if (!header.startsWith('%PDF')) {
					console.error('[SIGN-PDF] Response is NOT a PDF', {
						requestId,
						header: header.slice(0, 10),
						preview: bytes.toString('utf8', 0, 500).slice(0, 500)
					});
				}
			}
		}

		return new Response(pdfBuffer as unknown as BodyInit, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
				'Content-Length': String(pdfBuffer.length),
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (err) {
		console.error('[SIGN-PDF] Failed to fetch contract PDF:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch contract PDF');
	}
};
