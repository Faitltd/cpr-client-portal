import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import { supabase, getCommsForDeal, getDailyLogsForDeal, getPendingApprovalsForDeal, getFieldUpdatesByDeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

function buildEmailHtml(
	dealName: string,
	activity: { comms: any[]; logs: any[]; approvals: any[]; fieldUpdates: any[] }
): string {
	const commsHtml = activity.comms.length > 0
		? activity.comms.slice(0, 5).map(c =>
			`<li style="margin-bottom:6px;color:#374151;">${c.subject || c.summary || 'Communication logged'} <span style="color:#6b7280;font-size:13px;">(${c.channel || ''})</span></li>`
		).join('')
		: '<li style="color:#6b7280;">No recent communications.</li>';

	const logsHtml = activity.logs.length > 0
		? activity.logs.slice(0, 5).map(l =>
			`<li style="margin-bottom:6px;color:#374151;">${l.work_completed || 'Daily log submitted'} <span style="color:#6b7280;font-size:13px;">(${l.log_date || ''})</span></li>`
		).join('')
		: '<li style="color:#6b7280;">No recent daily logs.</li>';

	const approvalsHtml = activity.approvals.length > 0
		? activity.approvals.slice(0, 5).map(a =>
			`<li style="margin-bottom:6px;color:#374151;">${a.title || 'Pending approval'} — <strong>${a.status}</strong></li>`
		).join('')
		: '<li style="color:#6b7280;">No pending decisions.</li>';

	const updatesHtml = activity.fieldUpdates.length > 0
		? activity.fieldUpdates.slice(0, 5).map(u =>
			`<li style="margin-bottom:6px;color:#374151;">${u.type || 'Update'}: ${u.body || 'Field update submitted'}</li>`
		).join('')
		: '<li style="color:#6b7280;">No recent field updates.</li>';

	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
  <tr><td style="background:#0066cc;padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Custom Professional Renovations</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Project Update</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <h2 style="margin:0 0 4px;color:#111827;font-size:18px;">${dealName}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Here's what's been happening on your project.</p>

    <h3 style="margin:0 0 10px;color:#111827;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;">Recent Activity</h3>
    <ul style="padding-left:18px;margin:0 0 24px;">${commsHtml}</ul>

    <h3 style="margin:0 0 10px;color:#111827;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;">Daily Logs</h3>
    <ul style="padding-left:18px;margin:0 0 24px;">${logsHtml}</ul>

    <h3 style="margin:0 0 10px;color:#111827;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;">Field Updates</h3>
    <ul style="padding-left:18px;margin:0 0 24px;">${updatesHtml}</ul>

    <h3 style="margin:0 0 10px;color:#111827;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;">Pending Decisions</h3>
    <ul style="padding-left:18px;margin:0 0 24px;">${approvalsHtml}</ul>

    <div style="text-align:center;margin:28px 0 0;">
      <a href="#" style="display:inline-block;background:#0066cc;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">View Project Dashboard</a>
    </div>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;text-align:center;">
      You're receiving this because you're subscribed to project updates.<br>
      <a href="#" style="color:#0066cc;text-decoration:underline;">Manage email preferences</a> · <a href="#" style="color:#0066cc;text-decoration:underline;">Unsubscribe</a>
    </p>
    <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;text-align:center;">© ${new Date().getFullYear()} Custom Professional Renovations</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export const POST: RequestHandler = async ({ cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	try {
		const now = new Date();

		const { data: prefs, error: prefsError } = await supabase
			.from('email_preferences')
			.select('*')
			.eq('enabled', true)
			.neq('frequency', 'none');

		if (prefsError) throw new Error(prefsError.message);
		if (!prefs || prefs.length === 0) {
			return json({ data: { sent: 0, skipped: 0, failed: 0, details: [] } });
		}

		const duePrefs = prefs.filter((p: any) => {
			if (!p.last_sent_at) return true;
			const last = new Date(p.last_sent_at);
			const diffHours = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
			if (p.frequency === 'daily') return diffHours >= 23;
			if (p.frequency === 'weekly') return diffHours >= 167;
			return false;
		});

		if (duePrefs.length === 0) {
			return json({ data: { sent: 0, skipped: prefs.length, failed: 0, details: [] } });
		}

		let sent = 0;
		let skipped = 0;
		let failed = 0;
		const details: any[] = [];

		for (const pref of duePrefs) {
			try {
				const [comms, logs, approvals, fieldUpdates] = await Promise.all([
					getCommsForDeal(pref.deal_id),
					getDailyLogsForDeal(pref.deal_id),
					getPendingApprovalsForDeal(pref.deal_id),
					getFieldUpdatesByDeal(pref.deal_id)
				]);

				const hasActivity = comms.length > 0 || logs.length > 0 || approvals.length > 0 || fieldUpdates.length > 0;
				if (!hasActivity) {
					const { error: insertError } = await supabase.from('sent_emails').insert({
						deal_id: pref.deal_id,
						client_email: pref.client_email,
						subject: 'Project Update (skipped - no activity)',
						status: 'skipped'
					});
					skipped++;
					details.push({ deal_id: pref.deal_id, email: pref.client_email, status: 'skipped', reason: 'no activity' });
					continue;
				}

				const dealName = `Project ${pref.deal_id.slice(-6)}`;
				const subject = `Your Project Update — ${dealName}`;
				const html = buildEmailHtml(dealName, { comms, logs, approvals, fieldUpdates });

				// Log the email as sent (actual email sending would be via an email service)
				const { error: insertError } = await supabase.from('sent_emails').insert({
					deal_id: pref.deal_id,
					client_email: pref.client_email,
					subject,
					status: 'sent'
				});

				await supabase
					.from('email_preferences')
					.update({ last_sent_at: now.toISOString(), updated_at: now.toISOString() })
					.eq('id', pref.id);

				sent++;
				details.push({ deal_id: pref.deal_id, email: pref.client_email, status: 'sent', subject, html });
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				const { error: insertError } = await supabase.from('sent_emails').insert({
					deal_id: pref.deal_id,
					client_email: pref.client_email,
					subject: 'Project Update (failed)',
					status: 'failed',
					error_message: errorMessage
				});
				if (insertError) console.error('Failed to log error email:', insertError.message);
				failed++;
				details.push({ deal_id: pref.deal_id, email: pref.client_email, status: 'failed', error: errorMessage });
			}
		}

		return json({ data: { sent, skipped, failed, details } });
	} catch (err) {
		console.error('POST /api/admin/send-updates error:', err);
		const error = err instanceof Error ? err.message : 'Failed to send updates';
		return json({ error }, { status: 500 });
	}
};
