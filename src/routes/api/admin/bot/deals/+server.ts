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

const EXCLUDE_STAGES = (env.BOT_SYNC_EXCLUDE_STAGES ?? 'Lost,On Hold,Completed')
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

	try {
		const valid = await ensureValidZohoToken();
		if (!valid) return json({ message: 'Zoho not connected' }, { status: 400 });

		const accessToken = valid.accessToken;
		const apiDomain = valid.apiDomain;

		// All Deals EXCEPT the excluded stages.
		const stageClauses = EXCLUDE_STAGES.map((s) => `(Stage:not_equal:${s})`).join('and');
		const criteria = encodeURIComponent(`(${stageClauses})`);
		const fields = 'Deal_Name,Stage,Contact_Name';

		const out: DealItem[] = [];
		const seen = new Set<string>();
		const excludeLower = new Set(EXCLUDE_STAGES.map((s) => s.toLowerCase()));
		let page = 1;
		while (page < 10) {
			const result = await zohoApiCall(
				accessToken,
				`/Deals/search?criteria=${criteria}&fields=${fields}&sort_by=Modified_Time&sort_order=desc&per_page=200&page=${page}`,
				{},
				apiDomain
			);
			const batch: any[] = Array.isArray(result?.data) ? result.data : [];
			if (batch.length === 0) break;
			for (const d of batch) {
				const id = String(d.id);
				if (seen.has(id)) continue;
				const stage = String(d.Stage || '').trim();
				// Belt-and-suspenders: Zoho's chained not_equal criteria does not
				// reliably filter stages with spaces (e.g. "On Hold"), so also
				// filter locally on the response.
				if (excludeLower.has(stage.toLowerCase())) continue;
				seen.add(id);
				out.push({
					id,
					deal_name: String(d.Deal_Name || ''),
					stage,
					contact_name: extractContactName(d.Contact_Name)
				});
			}
			if (!result?.info?.more_records) break;
			page += 1;
		}

		out.sort((a, b) => a.deal_name.localeCompare(b.deal_name));

		return json({ data: out, excludedStages: EXCLUDE_STAGES });
	} catch (err) {
		console.error('GET /api/admin/bot/deals error:', err);
		const message = err instanceof Error ? err.message : 'Failed to fetch deals';
		return json({ message }, { status: 500 });
	}
};
