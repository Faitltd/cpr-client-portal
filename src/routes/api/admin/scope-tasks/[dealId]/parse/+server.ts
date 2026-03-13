import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { isValidAdminSession } from '$lib/server/admin';
import { getZohoTokens, upsertZohoTokens, bulkUpsertScopeTasks } from '$lib/server/db';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
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

const SYSTEM_PROMPT = `You are a renovation project task parser. Given a scope of work for a home renovation, extract individual tasks organized into construction phases.

For each task return:
- task_name: Clear, concise task name
- phase: One of: preconstruction, demo, rough, finish, closeout
- trade: One of: plumbing, electrical, tile, paint, general, hvac, framing, drywall, flooring, cabinetry, countertops, roofing, siding, windows, doors, or null
- duration_days: Estimated working days (integer)
- requires_inspection: true if needs building inspection
- requires_client_decision: true if client must make a selection/approval first
- description: Brief note or null

Order tasks logically:
- preconstruction: permits, engineering, design, material ordering
- demo: demolition, removal, protection
- rough: framing, plumbing rough, electrical rough, HVAC, insulation
- finish: drywall, tile, paint, trim, flooring, fixtures, cabinetry, countertops
- closeout: punch list, final inspection, cleaning, walkthrough

Return ONLY a JSON array of objects. No markdown fences, no explanation.`;

const PHASES = ['preconstruction', 'demo', 'rough', 'finish', 'closeout'];

export const POST: RequestHandler = async ({ params, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey || apiKey === 'your_openai_api_key') {
		return json({ message: 'OPENAI_API_KEY is not configured' }, { status: 500 });
	}

	try {
		// 1. Get Zoho tokens and refresh if needed
		const tokens = await getZohoTokens();
		if (!tokens) {
			return json({ message: 'Zoho not connected' }, { status: 400 });
		}

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

		// 2. Fetch deal from Zoho CRM
		const result = await zohoApiCall(
			accessToken,
			`/Deals/${params.dealId}`,
			{ method: 'GET' },
			apiDomain
		);

		const deal = result?.data?.[0];
		if (!deal) {
			return json({ message: 'Deal not found in CRM' }, { status: 404 });
		}

		// 3. Find scope text
		const scopeText = findScopeText(deal);
		if (!scopeText) {
			return json(
				{ message: 'No scope text found in this deal. Please add scope content to the CRM deal first.' },
				{ status: 400 }
			);
		}

		if (scopeText.length < 50) {
			return json(
				{ message: 'Scope text seems too short for accurate parsing', raw_scope: scopeText },
				{ status: 400 }
			);
		}

		// 4. Call OpenAI
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

		// 5. Parse JSON response
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
			// Try stripping markdown fences if present
			const cleaned = content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
			parsed = JSON.parse(cleaned);
		}

		if (!Array.isArray(parsed)) {
			return json({ message: 'OpenAI did not return a valid task array' }, { status: 500 });
		}

		// 6. Assign sort_order within each phase
		const phaseCounters: Record<string, number> = {};
		const tasksToInsert = parsed.map((t) => {
			const phase = PHASES.includes(t.phase) ? t.phase : 'finish';
			if (!(phase in phaseCounters)) phaseCounters[phase] = 0;
			const sort_order = phaseCounters[phase]++;

			return {
				id: crypto.randomUUID(),
				deal_id: params.dealId,
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

		// 7. Clear existing and bulk insert
		const savedTasks = await bulkUpsertScopeTasks(params.dealId, tasksToInsert);

		return json({ data: savedTasks, raw_scope: scopeText }, { status: 201 });
	} catch (err) {
		console.error('POST /api/admin/scope-tasks/[dealId]/parse error:', err);
		const message = err instanceof Error ? err.message : 'Failed to parse scope';
		return json({ message }, { status: 500 });
	}
};
