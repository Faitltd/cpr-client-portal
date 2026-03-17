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

const SYSTEM_PROMPT = `You are a renovation project task parser for Custom Professional Renovations (CPR). Your job is to parse a renovation estimate PDF into structured tasks. You MUST extract EVERY line item — do not skip, merge, or summarize any items.

STEP 1 — Identify the section headers in the estimate. Estimates are organized with numbered sections (e.g., "1. Demo", "2. Framing", "3. Cabinetry & Countertop"). Extract each section header exactly as written (without the number prefix).

STEP 2 — For each line item under a section, create a task object. Line items are typically numbered like 1.1, 1.2, 3.1, 3.2, etc.

Each task object must have:
- task_name: Clean, concise name for the task (e.g., "Interior Demolition", "Quartz Countertop Material & Labor"). NO prefixes like "Task Name:" or "Description:". Just the task itself.
- phase: The EXACT section header this line item falls under (e.g., "Demo", "Framing", "Cabinetry & Countertop"). Use the estimate's own section names — do NOT invent generic phases.
- phase_order: The 1-based index of the section in the estimate (first section = 1, second = 2, etc.). This preserves the original estimate ordering.
- trade: Best-fit trade from this list: plumbing, electrical, tile, paint, general, hvac, framing, drywall, flooring, cabinetry, countertops, roofing, siding, windows, doors — or null if none fit.
- duration_days: Estimated working days (integer, minimum 1).
- requires_inspection: true if this task likely needs a building inspection (e.g., rough plumbing, electrical, framing, HVAC).
- requires_client_decision: true if the client must select materials, finishes, or fixtures.
- description: Brief note with any allowance amounts, material specs, or scope details. Keep concise. Do NOT duplicate the task_name here.

CRITICAL RULES:
- Extract ALL line items. If the estimate has 33 line items, return 33 tasks. Do NOT skip any.
- Use the estimate's own section headers as the phase value — do NOT use generic phases like "rough", "finish", "closeout".
- Preserve the original section ordering via phase_order.
- task_name must be ONLY the task name — no labels, no descriptions mixed in.

Return ONLY a valid JSON array. No markdown fences, no commentary.`;

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

/** Strip common field-label prefixes the AI may include in task names. */
function cleanTaskName(raw: string): string {
	return raw
		.replace(/^(Task\s*Name|Short\s*Description|Trade\s*Partner\s*Notes|Description)\s*:\s*/i, '')
		.trim();
}

function buildTasks(
	parsed: Array<{
		task_name: string;
		phase: string;
		phase_order?: number;
		trade: string | null;
		duration_days: number;
		requires_inspection: boolean;
		requires_client_decision: boolean;
		description: string | null;
	}>,
	dealId: string
) {
	// Build phase_order from AI output, falling back to first-appearance order
	const phaseOrderMap: Record<string, number> = {};
	let nextOrder = 1;
	for (const t of parsed) {
		const phase = t.phase || 'General';
		if (!(phase in phaseOrderMap)) {
			phaseOrderMap[phase] = typeof t.phase_order === 'number' && t.phase_order > 0
				? t.phase_order
				: nextOrder;
			nextOrder++;
		}
	}

	const phaseCounters: Record<string, number> = {};
	return parsed.map((t) => {
		const phase = t.phase || 'General';
		if (!(phase in phaseCounters)) phaseCounters[phase] = 0;
		const sort_order = phaseCounters[phase]++;

		return {
			id: crypto.randomUUID(),
			deal_id: dealId,
			task_name: cleanTaskName(t.task_name) || 'Untitled Task',
			phase,
			phase_order: phaseOrderMap[phase] || 0,
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
			temperature: 0.3,
			max_tokens: 16384
		});

		const content = completion.choices[0]?.message?.content?.trim();
		if (!content) {
			return json({ message: 'OpenAI returned an empty response' }, { status: 500 });
		}

		// ── Parse JSON response ──────────────────────────────────────────
		let parsed: Array<{
			task_name: string;
			phase: string;
			phase_order?: number;
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

		// Merge phase_order back from tasksToInsert (column may not exist in DB yet)
		const phaseOrderById = new Map<string, number>(tasksToInsert.map((t) => [t.id, t.phase_order]));
		const tasksWithPhaseOrder = savedTasks.map((t) => ({
			...t,
			phase_order: t.phase_order ?? phaseOrderById.get(t.id) ?? 0
		}));

		return json({ data: tasksWithPhaseOrder, raw_scope: scopeText, source }, { status: 201 });
	} catch (err) {
		console.error('POST /api/admin/scope-tasks/[dealId]/parse error:', err);
		const message = err instanceof Error ? err.message : 'Failed to parse scope';
		return json({ message }, { status: 500 });
	}
};
