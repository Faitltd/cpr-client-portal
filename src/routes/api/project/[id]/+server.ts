import { json, error } from '@sveltejs/kit';
import { getSession } from '$lib/server/db';
import { zohoApiCall, refreshAccessToken } from '$lib/server/zoho';
import { getContactDocuments, getDealNotes } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const sessionId = cookies.get('portal_session');
	const dealId = params.id;

	if (!sessionId) {
		throw error(401, 'Not authenticated');
	}

	if (!dealId) {
		throw error(400, 'Deal ID required');
	}

	try {
		// Get session from database
		const session = await getSession(sessionId);
		if (!session) {
			throw error(401, 'Invalid session');
		}

		// Check token expiry and refresh if needed
		let accessToken = session.access_token;
		if (new Date(session.expires_at) < new Date()) {
			const newTokens = await refreshAccessToken(session.refresh_token);
			accessToken = newTokens.access_token;
		}

		// Fetch deal details
		const dealResponse = await zohoApiCall(accessToken, `/Deals/${dealId}`);
		const deal = dealResponse.data?.[0];

		if (!deal) {
			throw error(404, 'Deal not found');
		}

		// Security: Verify this deal belongs to the authenticated contact
		if (deal.Contact_Name?.id !== session.zoho_contact_id) {
			throw error(403, 'Access denied to this project');
		}

		// Fetch related data
		const [documents, notes] = await Promise.all([
			getContactDocuments(accessToken, dealId).catch(() => ({ data: [] })),
			getDealNotes(accessToken, dealId).catch(() => ({ data: [] }))
		]);

		return json({
			deal,
			documents: documents.data || [],
			notes: notes.data || []
		});
	} catch (err) {
		console.error('Failed to fetch project details:', err);
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Failed to fetch project details');
	}
};