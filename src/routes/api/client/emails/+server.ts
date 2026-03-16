import { json } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { crmApiCall } from '$lib/server/projects';
import type { RequestHandler } from './$types';

interface EmailTimelineItem {
	id: string;
	date: string;
	direction: 'inbound' | 'outbound';
	subject: string;
	summary: string | null;
	from_name: string | null;
	from_email: string | null;
	to: string[];
}

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const clientEmail = (context.session.client.email || '').toLowerCase();
		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);

		if (dealIds.length === 0) {
			return json({ data: [] });
		}

		// Fetch emails from Zoho CRM for each deal
		const allEmails: EmailTimelineItem[] = [];

		for (const dealId of dealIds) {
			try {
				let hasMore = true;
				let index: string | undefined;

				// Paginate through up to 30 emails per deal (3 pages of 10)
				let pages = 0;
				while (hasMore && pages < 3) {
					const params = index ? `?index=${encodeURIComponent(index)}` : '';
					const response = await crmApiCall(`/Deals/${dealId}/Emails${params}`);
					const emails = Array.isArray(response?.Emails) ? response.Emails : [];

					for (const email of emails) {
						const fromEmail = (email.from?.email || '').toLowerCase();
						const toEmails: string[] = Array.isArray(email.to)
							? email.to.map((t: any) => (t.email || '').toLowerCase())
							: [];

						// Determine direction based on whether client is sender or recipient
						const isSentByClient = fromEmail === clientEmail;
						const direction: 'inbound' | 'outbound' = isSentByClient ? 'outbound' : 'inbound';

						allEmails.push({
							id: email.message_id || `zoho-${dealId}-${emails.indexOf(email)}`,
							date: email.time || '',
							direction,
							subject: email.subject || '(No subject)',
							summary: email.summary || null,
							from_name: email.from?.user_name || null,
							from_email: email.from?.email || null,
							to: toEmails
						});
					}

					hasMore = response?.info?.more_records === true;
					index = response?.info?.next_index;
					pages++;
				}
			} catch (err) {
				// Log but don't fail — some deals may not have email access
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Failed to fetch emails for deal ${dealId}:`, msg);
			}
		}

		// Sort newest first
		allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

		// Deduplicate by message_id (same email might be on multiple deals)
		const seen = new Set<string>();
		const deduped = allEmails.filter((e) => {
			if (seen.has(e.id)) return false;
			seen.add(e.id);
			return true;
		});

		return json({ data: deduped.slice(0, 50) });
	} catch (err) {
		console.error('GET /api/client/emails error:', err);
		const error = err instanceof Error ? err.message : 'Failed to fetch emails';
		return json({ error }, { status: 500 });
	}
};
