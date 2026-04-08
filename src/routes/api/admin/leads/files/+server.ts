import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, getZohoApiBase } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const ALLOWED_FIELDS = new Set(['Photos', 'Image_Upload_4', 'File_Upload_1']);

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

async function getAccessToken() {
	const tokens = await getZohoTokens();
	if (!tokens) throw new Error('Zoho not connected');

	let accessToken = tokens.access_token;
	let apiDomain = tokens.api_domain ?? undefined;

	if (new Date(tokens.expires_at) < new Date()) {
		const refreshed = await refreshAccessToken(tokens.refresh_token);
		accessToken = refreshed.access_token;
		apiDomain = refreshed.api_domain || tokens.api_domain || undefined;
		await upsertZohoTokens({
			user_id: tokens.user_id,
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			expires_at: new Date(refreshed.expires_at).toISOString(),
			scope: tokens.scope,
			api_domain: apiDomain || null
		});
	}

	return { accessToken, apiDomain };
}

/** Download a file from a lead's file/image upload field */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const leadId = url.searchParams.get('leadId');
	const field = url.searchParams.get('field');

	if (!leadId || !field) {
		return json({ message: 'leadId and field are required' }, { status: 400 });
	}
	if (!ALLOWED_FIELDS.has(field)) {
		return json({ message: 'Invalid field' }, { status: 400 });
	}

	try {
		const { accessToken, apiDomain } = await getAccessToken();
		const base = getZohoApiBase(apiDomain);
		const downloadUrl = `${base}/Leads/${encodeURIComponent(leadId)}/${encodeURIComponent(field)}/actions/download`;

		const response = await fetch(downloadUrl, {
			headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
		});

		if (!response.ok) {
			if (response.status === 204 || response.status === 404) {
				return json({ message: 'No file found' }, { status: 404 });
			}
			const errText = await response.text();
			return json({ message: errText || 'Download failed' }, { status: response.status });
		}

		const contentType = response.headers.get('content-type') || 'application/octet-stream';
		const contentDisposition = response.headers.get('content-disposition') || '';
		const body = await response.arrayBuffer();

		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				...(contentDisposition ? { 'Content-Disposition': contentDisposition } : {})
			}
		});
	} catch (err) {
		console.error('GET /api/admin/leads/files error:', err);
		const message = err instanceof Error ? err.message : 'Download failed';
		return json({ message }, { status: 500 });
	}
};

/** Upload a file to a lead's file/image upload field */
export const POST: RequestHandler = async ({ cookies, request, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const leadId = url.searchParams.get('leadId');
	const field = url.searchParams.get('field');

	if (!leadId || !field) {
		return json({ message: 'leadId and field are required' }, { status: 400 });
	}
	if (!ALLOWED_FIELDS.has(field)) {
		return json({ message: 'Invalid field' }, { status: 400 });
	}

	try {
		const { accessToken, apiDomain } = await getAccessToken();
		const base = getZohoApiBase(apiDomain);
		const uploadUrl = `${base}/Leads/${encodeURIComponent(leadId)}/${encodeURIComponent(field)}/actions/upload`;

		const formData = await request.formData();
		const file = formData.get('file');
		if (!file || !(file instanceof File)) {
			return json({ message: 'No file provided' }, { status: 400 });
		}

		// Build multipart form for Zoho
		const zohoForm = new FormData();
		zohoForm.append('file', file, file.name);

		const response = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
			body: zohoForm
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error('Zoho upload error:', response.status, errText);
			return json({ message: errText || 'Upload failed' }, { status: response.status });
		}

		const result = await response.json().catch(() => ({}));
		return json({ message: 'Uploaded', data: result });
	} catch (err) {
		console.error('POST /api/admin/leads/files error:', err);
		const message = err instanceof Error ? err.message : 'Upload failed';
		return json({ message }, { status: 500 });
	}
};

/** Delete a file from a lead's file/image upload field */
export const DELETE: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const leadId = url.searchParams.get('leadId');
	const field = url.searchParams.get('field');

	if (!leadId || !field) {
		return json({ message: 'leadId and field are required' }, { status: 400 });
	}
	if (!ALLOWED_FIELDS.has(field)) {
		return json({ message: 'Invalid field' }, { status: 400 });
	}

	try {
		const { accessToken, apiDomain } = await getAccessToken();
		const base = getZohoApiBase(apiDomain);
		const deleteUrl = `${base}/Leads/${encodeURIComponent(leadId)}/${encodeURIComponent(field)}/actions/delete`;

		const response = await fetch(deleteUrl, {
			method: 'DELETE',
			headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
		});

		if (!response.ok) {
			const errText = await response.text();
			return json({ message: errText || 'Delete failed' }, { status: response.status });
		}

		return json({ message: 'Deleted' });
	} catch (err) {
		console.error('DELETE /api/admin/leads/files error:', err);
		const message = err instanceof Error ? err.message : 'Delete failed';
		return json({ message }, { status: 500 });
	}
};
