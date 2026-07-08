import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getBotAccess } from '$lib/server/bot-access';
import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';
import type { RequestHandler } from './$types';

interface DealItem {
	id: string;
	deal_name: string;
	stage: string;
	contact_name: string;
}

// Hide only closed deals (Lost, Completed) from the assistant. Keep On Hold
// selectable so active-but-paused clients (e.g. Lisbeth Ojemann) still show.
// Override with BOT_SYNC_EXCLUDE_STAGES.
const EXCLUDE_STAGES = (env.BOT_SYNC_EXCLUDE_STAGES ?? 'Lost,Completed')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

function extractContactName(contact: unknown): string {
	if (!contact) return '';
	if (typeof contact === 'string') return contact;
	if (typeof contact === 'object' && contact !== null && 'name' in contact) {
		return String((contact as { name: unknown }).name);
	}
	return '';
}

export const GET: RequestHandler = async ({ cookies }) => {
	const access = await getBotAccess(cookies);
	if (!access) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	// Admin deal list — CPR internal only. Don't let an expired admin session
	// fall through to a lingering trade/portal cookie (see chat endpoint note).
	if (access.role !== 'admin' && access.role !== 'designer') {
		return json({ message: 'Admin session expired — please sign in again.' }, { status: 401 });
	}

	try {
		const valid = await ensureValidZohoToken();
		if (!valid) return json({ message: 'Zoho not connected' }, { status: 400 });

		const accessToken = valid.accessToken;
		const apiDomain = valid.apiDomain;

		// Use COQL, not /Deals/search. The search API's chained `not_equal`
		// criteria is unreliable for picklist stages with spaces (e.g. "On Hold")
		// and can silently drop matching deals. COQL's `!=` filter is exact, so
		// On Hold deals (e.g. Lisbeth Ojemann) reliably appear.
		const excludeLower = new Set(EXCLUDE_STAGES.map((s) => s.toLowerCase()));
		const whereClause =
			EXCLUDE_STAGES.length > 0
				? EXCLUDE_STAGES.map((s) => `Stage != '${s.replace(/'/g, "\\'")}'`).join(' and ')
				: 'Stage is not null';

		const out: DealItem[] = [];
		const seen = new Set<string>();
		const perPage = 200;
		for (let page = 0; page < 25; page += 1) {
			const offset = page * perPage;
			const result = await zohoApiCall(
				accessToken,
				'/coql',
				{
					method: 'POST',
					body: JSON.stringify({
						select_query: `SELECT Deal_Name, Stage, Contact_Name FROM Deals WHERE ${whereClause} ORDER BY Modified_Time DESC LIMIT ${perPage} OFFSET ${offset}`
					})
				},
				apiDomain
			);
			const batch: any[] = Array.isArray(result?.data) ? result.data : [];
			if (batch.length === 0) break;
			for (const d of batch) {
				const id = String(d.id);
				if (seen.has(id)) continue;
				const stage = String(d.Stage || '').trim();
				if (excludeLower.has(stage.toLowerCase())) continue;
				seen.add(id);
				out.push({
					id,
					deal_name: String(d.Deal_Name || ''),
					stage,
					contact_name: extractContactName(d.Contact_Name)
				});
			}
			if (!result?.info?.more_records || batch.length < perPage) break;
		}

		out.sort((a, b) => a.deal_name.localeCompare(b.deal_name));

		return json({ data: out, excludedStages: EXCLUDE_STAGES });
	} catch (err) {
		console.error('GET /api/admin/bot/deals error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch deals';
		return json({ message }, { status: 500 });
	}
};
