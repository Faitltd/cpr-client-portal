import { json } from '@sveltejs/kit';
import { getClientDashboardContext } from '$lib/server/client-dashboard';
import { supabase, getCommsForDeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface EmailTimelineItem {
	id: string;
	date: string;
	direction: 'inbound' | 'outbound';
	subject: string;
	summary: string | null;
	source: 'sent_email' | 'comms_log';
	status?: string;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionToken = cookies.get('portal_session');

	try {
		const context = await getClientDashboardContext(sessionToken);
		if (!context) return json({ error: 'Unauthorized' }, { status: 401 });

		const clientEmail = context.session.client.email;
		const dealIds = context.deals.map((d: any) => String(d?.id || '').trim()).filter(Boolean);

		if (dealIds.length === 0) {
			return json({ data: [] });
		}

		// Fetch sent emails from the automated update system
		const { data: sentEmails, error: sentError } = await supabase
			.from('sent_emails')
			.select('*')
			.eq('client_email', clientEmail)
			.in('deal_id', dealIds)
			.in('status', ['sent', 'delivered'])
			.order('created_at', { ascending: false })
			.limit(50);

		if (sentError) {
			console.error('sent_emails query error:', sentError.message);
		}

		// Fetch email comms from the comms log (both directions)
		const commsResults = await Promise.all(
			dealIds.map(async (dealId) => {
				try {
					const comms = await getCommsForDeal(dealId);
					return comms.filter((c) => c.channel === 'email');
				} catch {
					return [];
				}
			})
		);
		const emailComms = commsResults.flat();

		// Merge into a unified timeline
		const timeline: EmailTimelineItem[] = [];

		// Add sent emails (outbound automated updates)
		if (sentEmails) {
			for (const email of sentEmails) {
				timeline.push({
					id: `sent-${email.id}`,
					date: email.created_at,
					direction: 'outbound',
					subject: email.subject || 'Project Update',
					summary: null,
					source: 'sent_email',
					status: email.status
				});
			}
		}

		// Add comms log entries (can be inbound or outbound)
		for (const comm of emailComms) {
			timeline.push({
				id: `comm-${comm.id}`,
				date: comm.created_at,
				direction: comm.direction || 'outbound',
				subject: comm.subject || 'Email',
				summary: comm.summary,
				source: 'comms_log'
			});
		}

		// Deduplicate: if a sent_email and comms_log entry are within 5 min with same deal_id
		// and similar subject, keep the comms_log entry (it has more detail)
		const deduped = deduplicateTimeline(timeline);

		// Sort chronologically (newest first)
		deduped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

		return json({ data: deduped.slice(0, 50) });
	} catch (err) {
		console.error('GET /api/client/emails error:', err);
		const error = err instanceof Error ? err.message : 'Failed to fetch emails';
		return json({ error }, { status: 500 });
	}
};

function deduplicateTimeline(items: EmailTimelineItem[]): EmailTimelineItem[] {
	const result: EmailTimelineItem[] = [];
	const sentEmailsByDate = new Map<string, EmailTimelineItem>();
	const commsByDate = new Map<string, EmailTimelineItem>();

	for (const item of items) {
		if (item.source === 'sent_email') {
			sentEmailsByDate.set(item.date, item);
		} else {
			commsByDate.set(item.date, item);
		}
	}

	// For each comms_log entry, check if there's a matching sent_email within 5 minutes
	const matchedSentIds = new Set<string>();

	for (const comm of items.filter((i) => i.source === 'comms_log')) {
		const commTime = new Date(comm.date).getTime();
		let matched = false;

		for (const sent of items.filter((i) => i.source === 'sent_email')) {
			const sentTime = new Date(sent.date).getTime();
			if (Math.abs(commTime - sentTime) < 5 * 60 * 1000) {
				matchedSentIds.add(sent.id);
				matched = true;
				break;
			}
		}

		result.push(comm);
	}

	// Add sent_emails that weren't matched
	for (const item of items.filter((i) => i.source === 'sent_email')) {
		if (!matchedSentIds.has(item.id)) {
			result.push(item);
		}
	}

	return result;
}
