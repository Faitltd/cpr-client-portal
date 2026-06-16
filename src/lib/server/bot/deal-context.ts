import { zohoApiCall } from '$lib/server/zoho';
import { ensureValidZohoToken } from '$lib/server/zoho-token';

export interface DealContext {
	id: string;
	name: string;
	stage: string;
	address: string | null;
	primary_contact: {
		id: string | null;
		name: string;
		email: string | null;
		phone: string | null;
	} | null;
	account: { id: string | null; name: string } | null;
	closing_date: string | null;
	amount: number | null;
	owner: string | null;
	ball_in_court: string | null;
	ball_in_court_note: string | null;
	description: string | null;
	refined_scope: string | null;
	garage_code: string | null;
	wifi: string | null;
	workdrive_url: string | null;
	created_time: string | null;
	modified_time: string | null;
	raw_fields: Record<string, unknown>;
}

const DEAL_FIELDS = [
	'Deal_Name',
	'Stage',
	'Amount',
	'Closing_Date',
	'Owner',
	'Contact_Name',
	'Account_Name',
	'Address',
	'Address_Line_2',
	'Street',
	'City',
	'State',
	'Zip_Code',
	'Garage_Code',
	'WiFi',
	'Access_Notes',
	'Access_Code',
	'Door_Code',
	'Lockbox',
	'Alarm_Code',
	'Pet_Notes',
	'Site_Notes',
	'Ball_In_Court',
	'Ball_In_Court_Note',
	'Description',
	'Refined_Scope',
	'Project_Notes',
	'Client_Portal_Folder',
	'External_Link',
	'WorkDrive_Internal_URL',
	'Created_Time',
	'Modified_Time'
].join(',');

// Standard Zoho/system fields we don't bother showing in the "extras" dump.
const HIDE_RAW_FIELDS = new Set([
	'id',
	'$approved',
	'$approval',
	'$editable',
	'$in_merge',
	'$line_tax',
	'$process_flow',
	'$orchestration',
	'$converted',
	'$converted_detail',
	'$state',
	'$pathfinder',
	'$locked_for_me',
	'$has_more',
	'$wizard_connection_path',
	'$canvas_id',
	'$followers',
	'$following',
	'$review_process',
	'$review',
	'$sharing_permission',
	'$layout_id',
	'$module',
	'$share_permissions',
	'$tag',
	'Tag',
	'Created_By',
	'Modified_By',
	'Last_Activity_Time',
	'Lead_Conversion_Time',
	'Probability',
	'Expected_Revenue',
	'Layout',
	'Currency',
	'Exchange_Rate'
]);

const CONTACT_FIELDS = ['Full_Name', 'Email', 'Phone', 'Mobile'].join(',');

function pickString(rec: Record<string, unknown>, key: string): string | null {
	const v = rec[key];
	if (v == null) return null;
	if (typeof v === 'string') return v.trim() || null;
	if (typeof v === 'object' && 'name' in (v as Record<string, unknown>)) {
		const name = (v as Record<string, unknown>).name;
		return typeof name === 'string' ? name : null;
	}
	return String(v);
}

function pickLookupId(rec: Record<string, unknown>, key: string): string | null {
	const v = rec[key];
	if (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
		const id = (v as Record<string, unknown>).id;
		return id != null ? String(id) : null;
	}
	return null;
}

function pickNumber(rec: Record<string, unknown>, key: string): number | null {
	const v = rec[key];
	if (typeof v === 'number') return v;
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
	return null;
}

function composeAddress(rec: Record<string, unknown>): string | null {
	const full = pickString(rec, 'Address');
	if (full) return full;
	const parts = [
		pickString(rec, 'Street'),
		pickString(rec, 'Address_Line_2'),
		pickString(rec, 'City'),
		pickString(rec, 'State'),
		pickString(rec, 'Zip_Code')
	]
		.map((p) => (p ? p.trim() : ''))
		.filter(Boolean);
	return parts.length ? parts.join(', ') : null;
}

function extractWorkdriveUrl(rec: Record<string, unknown>): string | null {
	const candidates = [rec.Client_Portal_Folder, rec.External_Link];
	for (const c of candidates) {
		if (typeof c !== 'string') continue;
		const trimmed = c.trim();
		if (!trimmed) continue;
		try {
			const u = new URL(trimmed);
			if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
		} catch {
			/* skip */
		}
	}
	return null;
}

async function getValidAccessToken(): Promise<{ accessToken: string; apiDomain?: string }> {
	const valid = await ensureValidZohoToken();
	if (!valid) throw new Error('Zoho not connected');

	return { accessToken: valid.accessToken, apiDomain: valid.apiDomain };
}

async function fetchContact(
	accessToken: string,
	apiDomain: string | undefined,
	contactId: string
): Promise<{ email: string | null; phone: string | null }> {
	try {
		const result = await zohoApiCall(
			accessToken,
			`/Contacts/${encodeURIComponent(contactId)}?fields=${CONTACT_FIELDS}`,
			{},
			apiDomain
		);
		const rec = Array.isArray(result?.data) ? (result.data[0] as Record<string, unknown>) : null;
		if (!rec) return { email: null, phone: null };
		return {
			email: pickString(rec, 'Email'),
			phone: pickString(rec, 'Phone') ?? pickString(rec, 'Mobile')
		};
	} catch {
		return { email: null, phone: null };
	}
}

export async function getDealContext(dealId: string): Promise<DealContext> {
	const { accessToken, apiDomain } = await getValidAccessToken();
	const result = await zohoApiCall(
		accessToken,
		`/Deals/${encodeURIComponent(dealId)}?fields=${DEAL_FIELDS}`,
		{},
		apiDomain
	);
	const records = result?.data;
	if (!Array.isArray(records) || records.length === 0) {
		throw new Error(`Deal ${dealId} not found`);
	}
	const rec = records[0] as Record<string, unknown>;

	const contactName = pickString(rec, 'Contact_Name');
	const contactId = pickLookupId(rec, 'Contact_Name');
	const accountName = pickString(rec, 'Account_Name');
	const accountId = pickLookupId(rec, 'Account_Name');

	let contactEmail: string | null = null;
	let contactPhone: string | null = null;
	if (contactId) {
		const c = await fetchContact(accessToken, apiDomain, contactId);
		contactEmail = c.email;
		contactPhone = c.phone;
	}

	return {
		id: dealId,
		name: pickString(rec, 'Deal_Name') ?? '',
		stage: pickString(rec, 'Stage') ?? '',
		address: composeAddress(rec),
		primary_contact: contactName
			? { id: contactId, name: contactName, email: contactEmail, phone: contactPhone }
			: null,
		account: accountName ? { id: accountId, name: accountName } : null,
		closing_date: pickString(rec, 'Closing_Date'),
		amount: pickNumber(rec, 'Amount'),
		owner: pickString(rec, 'Owner'),
		ball_in_court: pickString(rec, 'Ball_In_Court'),
		ball_in_court_note: pickString(rec, 'Ball_In_Court_Note'),
		description: pickString(rec, 'Description'),
		refined_scope: pickString(rec, 'Refined_Scope'),
		garage_code: pickString(rec, 'Garage_Code'),
		wifi: pickString(rec, 'WiFi'),
		workdrive_url: extractWorkdriveUrl(rec),
		created_time: pickString(rec, 'Created_Time'),
		modified_time: pickString(rec, 'Modified_Time'),
		raw_fields: rec
	};
}

function stripHtml(s: string): string {
	return s
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function renderRawFieldValue(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		return truncate(stripHtml(trimmed), 800);
	}
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if ('name' in obj && typeof obj.name === 'string') return obj.name;
		if (Array.isArray(value)) {
			const items = value
				.map((v) => renderRawFieldValue(v))
				.filter((s): s is string => Boolean(s));
			return items.length ? items.join(', ') : null;
		}
	}
	return null;
}

export function renderDealContextBlock(ctx: DealContext): string {
	const lines: string[] = [];
	lines.push(`Deal: ${ctx.name} (Zoho id=${ctx.id})`);
	lines.push(`Stage: ${ctx.stage || 'unknown'}`);
	lines.push(`Address: ${ctx.address ?? 'unknown'}`);
	if (ctx.account) lines.push(`Account: ${ctx.account.name}`);
	if (ctx.primary_contact) {
		const c = ctx.primary_contact;
		lines.push(
			`Primary contact: ${c.name}` +
				(c.email ? ` <${c.email}>` : '') +
				(c.phone ? ` (${c.phone})` : '')
		);
	}
	lines.push(`Owner: ${ctx.owner ?? 'unknown'}`);
	lines.push(`Closing date: ${ctx.closing_date ?? 'unknown'}`);
	lines.push(`Amount: ${ctx.amount != null ? `$${ctx.amount.toLocaleString()}` : 'unknown'}`);
	if (ctx.ball_in_court) lines.push(`Ball in court: ${ctx.ball_in_court}`);
	if (ctx.ball_in_court_note) lines.push(`Ball-in-court note: ${ctx.ball_in_court_note}`);
	if (ctx.garage_code) lines.push(`Garage code: ${ctx.garage_code}`);
	if (ctx.wifi) lines.push(`Wi-Fi: ${ctx.wifi}`);
	if (ctx.workdrive_url) lines.push(`WorkDrive folder: ${ctx.workdrive_url}`);

	// Dump any remaining fields from the live Deal record so the bot can match
	// on whatever names the user uses (e.g. "access code" → Access_Notes).
	const renderedKeys = new Set([
		'Deal_Name',
		'Stage',
		'Amount',
		'Closing_Date',
		'Owner',
		'Contact_Name',
		'Account_Name',
		'Address',
		'Address_Line_2',
		'Street',
		'City',
		'State',
		'Zip_Code',
		'Garage_Code',
		'WiFi',
		'Ball_In_Court',
		'Ball_In_Court_Note',
		'Refined_Scope',
		'Description',
		'Client_Portal_Folder',
		'External_Link',
		'WorkDrive_Internal_URL',
		'Created_Time',
		'Modified_Time'
	]);
	const extras: string[] = [];
	for (const [key, raw] of Object.entries(ctx.raw_fields)) {
		if (renderedKeys.has(key)) continue;
		if (HIDE_RAW_FIELDS.has(key)) continue;
		if (key.startsWith('$')) continue;
		const rendered = renderRawFieldValue(raw);
		if (!rendered) continue;
		const label = key.replace(/_/g, ' ');
		extras.push(`${label}: ${rendered}`);
	}
	if (extras.length > 0) {
		lines.push('');
		lines.push('Other Deal fields:');
		for (const e of extras) lines.push(`- ${e}`);
	}

	if (ctx.refined_scope) {
		lines.push('');
		lines.push('Refined scope:');
		lines.push(truncate(stripHtml(ctx.refined_scope), 2000));
	} else if (ctx.description) {
		lines.push('');
		lines.push('Description:');
		lines.push(truncate(stripHtml(ctx.description), 2000));
	}
	return lines.join('\n');
}
