import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/db';
import { postCliqChatMessage, type CliqMessage, type CliqPostResult } from '$lib/server/cliq';
import { isVideoPath, UPDATE_TYPE_LABELS } from '$lib/server/zoho-field-updates';

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — Cliq fetches the image at post time
const CLIQ_CO_CHAT_ID = env.ZOHO_CLIQ_CO_CHAT_ID || 'O5797744000003118001';

/**
 * Emoji prefix for each update_type — kept in one place so the Cliq messages
 * have visual consistency.
 */
const UPDATE_TYPE_EMOJI: Record<string, string> = {
	progress: '📝',
	issue: '⚠️',
	material_delivery: '📦',
	inspection: '🔍',
	weather_delay: '🌧️',
	schedule_change: '📅',
	completed_work: '✅',
	change_order: '🛠️',
	other: '💬'
};

export interface FieldUpdateCliqNotification {
	accessToken: string;
	updateType: string; // one of UPDATE_TYPE_LABELS keys
	dealName: string | null;
	dealId: string;
	submitterName: string;
	submitterEmail: string | null;
	submitterRole: 'client' | 'trade';
	note: string | null;
	photoIds: string[] | null;
	/** Optional links — included beneath the message if provided */
	booksUrl?: string | null;
	crmRecordUrl?: string | null;
}

/**
 * Post a Field Update notification to Cliq with inline image previews.
 *
 * Builds a rich message containing:
 *   - Title with emoji + label for the update type
 *   - Project + submitter info
 *   - The user's note
 *   - Attachment summary line (with Books draft link if provided)
 *   - Inline image gallery (slides) for any non-video attachments,
 *     using Supabase signed URLs that Cliq fetches at post time
 *
 * Returns the structured CliqPostResult so callers can include the outcome
 * in their own response payload.
 */
export async function postFieldUpdateNotification(
	opts: FieldUpdateCliqNotification
): Promise<CliqPostResult> {
	const {
		accessToken,
		updateType,
		dealName,
		dealId,
		submitterName,
		submitterEmail,
		submitterRole,
		note,
		photoIds,
		booksUrl,
		crmRecordUrl
	} = opts;

	const emoji = UPDATE_TYPE_EMOJI[updateType] || '💬';
	const label = UPDATE_TYPE_LABELS[updateType] || updateType;
	const submitterTag = submitterRole === 'trade' ? 'Trade Partner' : 'Client';
	const submitterLine = submitterEmail
		? `*Submitted by:* ${submitterName} (${submitterEmail}) — ${submitterTag}`
		: `*Submitted by:* ${submitterName} — ${submitterTag}`;

	const lines: string[] = [
		`${emoji} *${label}*`,
		`*Project:* ${dealName || dealId}`,
		submitterLine
	];
	if (note && note.trim()) {
		lines.push('', note.trim());
	}

	// Image gallery — only non-video photos. Cliq fetches each URL server-side
	// at post time and stores its own copy, so signed URL expiry doesn't break
	// the message later.
	const imagePaths = Array.isArray(photoIds)
		? photoIds.filter((p) => !isVideoPath(p))
		: [];
	const videoCount = Array.isArray(photoIds)
		? photoIds.filter((p) => isVideoPath(p)).length
		: 0;

	const signedImageUrls: string[] = [];
	for (const path of imagePaths) {
		try {
			const { data, error } = await supabase.storage
				.from('trade-photos')
				.createSignedUrl(path, SIGNED_URL_TTL_SEC);
			if (error || !data?.signedUrl) {
				console.warn(
					`[cliq-notifications] signed URL failed for ${path}:`,
					error?.message
				);
				continue;
			}
			signedImageUrls.push(data.signedUrl);
		} catch (err) {
			console.warn(`[cliq-notifications] signed URL exception for ${path}:`, err);
		}
	}

	const totalAttachments = Array.isArray(photoIds) ? photoIds.length : 0;
	if (totalAttachments > 0) {
		const attachLabel = `${totalAttachments} attachment${totalAttachments === 1 ? '' : 's'}`;
		if (booksUrl) {
			lines.push('', `📎 ${attachLabel} — [view on the draft quote](${booksUrl})`);
		} else if (crmRecordUrl) {
			lines.push('', `📎 ${attachLabel} — [view in CRM](${crmRecordUrl})`);
		} else {
			lines.push('', `📎 ${attachLabel} uploaded.`);
		}
		if (videoCount > 0) {
			lines.push(
				`_(${videoCount} video${videoCount === 1 ? '' : 's'} not previewed inline — see attachments.)_`
			);
		}
	} else {
		// No attachments — still surface the relevant link if we have one.
		if (booksUrl) {
			lines.push('', `[Open the draft quote in Books](${booksUrl})`);
		} else if (crmRecordUrl) {
			lines.push('', `[Open in CRM](${crmRecordUrl})`);
		}
	}

	const message: CliqMessage = { text: lines.join('\n') };
	if (signedImageUrls.length > 0) {
		message.slides = [
			{
				type: 'images',
				title:
					signedImageUrls.length === 1
						? 'Attachment'
						: `Attachments (${signedImageUrls.length})`,
				data: signedImageUrls
			}
		];
	}

	return postCliqChatMessage(accessToken, CLIQ_CO_CHAT_ID, message);
}
