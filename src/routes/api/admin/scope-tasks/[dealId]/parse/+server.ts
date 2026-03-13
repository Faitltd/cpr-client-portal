import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens, bulkUpsertScopeTasks } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall, getZohoApiBase } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

function stripHtml(html: string): string {
	return html
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

function findScopeText(deal: Record<string, unknown>): string | null {
	// Try known scope field names first
	const knownNames = ['Scope', 'Scope_of_Work', 'Scope_Description', 'Scope1', 'Description'];
	for (const name of knownNames) {
		const val = deal[name];
		if (typeof val === 'string' && val.trim().length > 50) {
			return stripHtml(val);
		}
	}

	// Fallback: find the longest string field > 100 chars
	let longestField: string | null = null;
	let longestLen = 100;
	for (const [, val] of Object.entries(deal)) {
		if (typeof val === 'string' && val.trim().length > longestLen) {
			const cleaned = stripHtml(val);
			if (cleaned.length > longestLen) {
				longestField = cleaned;
				longestLen = cleaned.length;
			}
		}
	}
	return longestField;
}

const SYSTEM_PROMPT = `You are a renovation project task parser for Custom Professional Renovations (CPR). Parse a renovation estimate into construction tasks by phase.

For each task return: task_name, phase (preconstruction/demo/rough/finish/closeout), trade (plumbing/electrical/tile/paint/general/hvac/framing/drywall/flooring/cabinetry/countertops/roofing/siding/windows/doors or null), duration_days (integer), requires_inspection (boolean), requires_client_decision (boolean), description (include allowance amounts, keep concise).

Phase rules:
- preconstruction: material ordering/selection, permits, design
- demo: all removal/demolition
- rough: electrical outlets, plumbing rough-in, HVAC, framing
- finish: cabinet install, countertop, tile, flooring, paint, fixtures, appliances
- closeout: debris removal, cleaning, punch list, final inspection

Do not skip any line items. Material allowances become preconstruction ordering tasks. Return ONLY a JSON array. No markdown fences.`;

const PHASES = ['preconstruction', 'demo', 'rough', 'finish', 'closeout'];

async function extractPdfText(buffer: Buffer): Promise<string> {
	const data = await pdfParse(buffer);
	return data.text;
}

async function getZohoAuth(): Promise<{ accessToken: string; apiDomain: string | undefined } | null> {
	const tokens = await getZohoTokens();
	if (!tokens) return null;

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

async function fetchCrmPdfAttachment(
	accessToken: string,
	dealId: string,
	apiDomain: string | undefined
): Promise<Buffer | null> {
	try {
		const result = await zohoApiCall(
			accessToken,
			`/Deals/${dealId}/Attachments`,
			{ method: 'GET' },
			apiDomain
		);

		const attachments = result?.data;
		if (!Array.isArray(attachments) || attachments.length === 0) return null;

		// Find the first PDF attachment
		const pdfAttachment = attachments.find(
			(a: Record<string, unknown>) =>
				typeof a.File_Name === 'string' && a.File_Name.toLowerCase().endsWith('.pdf')
		);
		if (!pdfAttachment) return null;

		// Download the attachment directly (not via zohoApiCall which expects JSON)
		const base = getZohoApiBase(apiDomain);
		const downloadUrl = `${base}/Deals/${dealId}/Attachments/${pdfAttachment.id}`;
		const resp = await fetch(downloadUrl, {
			headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
		});

		if (!resp.ok) return null;
		return Buffer.from(await resp.arrayBuffer());
	} catch {
		return null;
	}
}

function buildTasks(
	parsed: Array<{
		task_name: string;
		phase: string;
		trade: string | null;
		duration_days: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		description: string | null;
	}>,
	dealId: string
) {
	const phaseCounters: Record<string, number> = {};
	return parsed.map((t) => {
		const phase = PHASES.includes(t.phase) ? t.phase : 'finish';
		if (!(phase in phaseCounters)) phaseCounters[phase] = 0;
		const sort_order = phaseCounters[phase]++;

		return {
			id: crypto.randomUUID(),
			deal_id: dealId,
			task_name: t.task_name || 'Untitled Task',
			phase,
			trade: t.trade || null,
			description: t.description || null,
			duration_days: typeof t.duration_days === 'number' && t.duration_days > 0 ? t.duration_days : 1,
			sort_order,
			requires_inspection: Boolean(t.requires_inspection),
			requires_client_decision: Boolean(t.requires_client_decision),
			dependency_id: null
		};
	});
}

export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey || apiKey === 'your_openai_api_key') {
		return json({ message: 'OPENAI_API_KEY is not configured' }, { status: 500 });
	}

	try {
		let scopeText: string | null = null;
		let source: 'pdf_upload' | 'crm_pdf' | 'crm_text' = 'crm_text';

		const contentType = request.headers.get('content-type') || '';

		if (contentType.includes('multipart/form-data')) {
			// ── Mode A: PDF file upload ──────────────────────────────────
			const formData = await request.formData();
			const file = formData.get('pdf');
			if (!file || !(file instanceof File)) {
				return json({ message: 'No PDF file provided' }, { status: 400 });
			}

			const buffer = Buffer.from(await file.arrayBuffer());
			scopeText = await extractPdfText(buffer);
			source = 'pdf_upload';
		} else {
			// ── Mode B: CRM fallback ─────────────────────────────────────
			const auth = await getZohoAuth();
			if (!auth) {
				return json({ message: 'Zoho not connected' }, { status: 400 });
			}

			// Try to fetch PDF attachment from CRM deal first
			const pdfBuffer = await fetchCrmPdfAttachment(
				auth.accessToken,
				params.dealId,
				auth.apiDomain
			);

			if (pdfBuffer) {
				scopeText = await extractPdfText(pdfBuffer);
				source = 'crm_pdf';
			} else {
				// Fall back to scope text field on the deal
				const result = await zohoApiCall(
					auth.accessToken,
					`/Deals/${params.dealId}`,
					{ method: 'GET' },
					auth.apiDomain
				);

				const deal = result?.data?.[0];
				if (!deal) {
					return json({ message: 'Deal not found in CRM' }, { status: 404 });
				}

				scopeText = findScopeText(deal);
				source = 'crm_text';
			}
		}

		if (!scopeText || scopeText.trim().length < 50) {
			return json(
				{
					message: source === 'pdf_upload'
						? 'Could not extract enough text from the PDF. Please check the file.'
						: 'No scope text found. Upload an estimate PDF or add scope content to the CRM deal.',
					raw_scope: scopeText || ''
				},
				{ status: 400 }
			);
		}

		// ── Call OpenAI ───────────────────────────────────────────────────
		const openai = new OpenAI({ apiKey });
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: scopeText }
			],
			temperature: 0.3
		});

		const content = completion.choices[0]?.message?.content?.trim();
		if (!content) {
			return json({ message: 'OpenAI returned an empty response' }, { status: 500 });
		}

		// ── Parse JSON response ──────────────────────────────────────────
		let parsed: Array<{
			task_name: string;
			phase: string;
			trade: string | null;
			duration_days: number;
			requires_inspection: boolean;
			requires_client_decision: boolean;
			description: string | null;
		}>;

		try {
			parsed = JSON.parse(content);
		} catch {
			const cleaned = content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
			parsed = JSON.parse(cleaned);
		}

		if (!Array.isArray(parsed)) {
			return json({ message: 'OpenAI did not return a valid task array' }, { status: 500 });
		}

		const tasksToInsert = buildTasks(parsed, params.dealId);
		const savedTasks = await bulkUpsertScopeTasks(params.dealId, tasksToInsert);

		return json({ data: savedTasks, raw_scope: scopeText, source }, { status: 201 });
	} catch (err) {
		console.error('POST /api/admin/scope-tasks/[dealId]/parse error:', err);
		const message = err instanceof Error ? err.message : 'Failed to parse scope';
		return json({ message }, { status: 500 });
	}
};
