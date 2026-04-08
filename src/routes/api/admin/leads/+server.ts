import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

const LEAD_STATUSES = [
	'New Lead - Discovery call needed',
	'Discovery Call Booked - Auto',
	'Site Visit Needed - Auto',
	'Booked - Site Visit - Auto'
];

const LIST_FIELDS = [
	'First_Name', 'Last_Name', 'Email', 'Phone', 'Lead_Status', 'Company'
].join(',');

const DETAIL_FIELDS = [
	'First_Name', 'Last_Name', 'Email', 'Phone', 'Lead_Status', 'Company',
	'Disco_Call', 'Description', 'Property_Type', 'What_are_the_must_have_features',
	'Budget_Range', 'Decision_Makers', 'Reside_During_Construction',
	'Finishes', 'Owner_Provided_Materials', 'Owner_Performed_Tasks',
	'Photos', 'Image_Upload_4', 'Unqualified', 'Prior_Renovations',
	'File_Upload_1', 'Selections_Availability', 'Access_Notes', 'Timeline',
	'Project_Details_Cont_d'
].join(',');

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

async function fetchLeadsByStatus(
	accessToken: string,
	status: string,
	apiDomain?: string
) {
	try {
		const result = await zohoApiCall(
			accessToken,
			`/Leads/search?criteria=(Lead_Status:equals:${encodeURIComponent(status)})&fields=${encodeURIComponent(LIST_FIELDS)}&per_page=200`,
			{},
			apiDomain
		);
		return Array.isArray(result?.data) ? result.data : [];
	} catch {
		return [];
	}
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { accessToken, apiDomain } = await getAccessToken();

		const leadId = url.searchParams.get('id');
		if (leadId) {
			const result = await zohoApiCall(
				accessToken,
				`/Leads/${encodeURIComponent(leadId)}?fields=${encodeURIComponent(DETAIL_FIELDS)}`,
				{},
				apiDomain
			);
			const record = result?.data?.[0];
			if (!record) return json({ message: 'Lead not found' }, { status: 404 });
			return json({ data: record });
		}

		const results = await Promise.all(
			LEAD_STATUSES.map(status => fetchLeadsByStatus(accessToken, status, apiDomain))
		);

		const seen = new Set<string>();
		const leads: Array<Record<string, unknown>> = [];
		for (const batch of results) {
			for (const lead of batch) {
				const id = String(lead.id);
				if (!seen.has(id)) {
					seen.add(id);
					leads.push(lead);
				}
			}
		}

		leads.sort((a, b) => {
			const aName = `${a.First_Name || ''} ${a.Last_Name || ''}`.trim().toLowerCase();
			const bName = `${b.First_Name || ''} ${b.Last_Name || ''}`.trim().toLowerCase();
			return aName.localeCompare(bName);
		});

		return json({ data: leads });
	} catch (err) {
		console.error('GET /api/admin/leads error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch leads';
		return json({ message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ cookies, request }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const { accessToken, apiDomain } = await getAccessToken();
		const body = await request.json();
		const { id, ...fields } = body;

		if (!id) return json({ message: 'Lead ID is required' }, { status: 400 });

		const result = await zohoApiCall(
			accessToken,
			'/Leads',
			{
				method: 'PUT',
				body: JSON.stringify({ data: [{ id, ...fields }] })
			},
			apiDomain
		);

		const detail = result?.data?.[0];
		if (detail?.code !== 'SUCCESS') {
			const msg = detail?.message || detail?.code || 'Update failed';
			return json({ message: msg }, { status: 400 });
		}

		return json({ message: 'Updated', data: detail });
	} catch (err) {
		console.error('PUT /api/admin/leads error:', err);
		const message = err instanceof Error ? err.message : 'Failed to update lead';
		return json({ message }, { status: 500 });
	}
};
