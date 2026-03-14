import {
	createApproval,
	createGenerationLog,
	getScopeDefinition,
	getTaskTemplatesByProjectType,
	getZohoTokens,
	updateGenerationLog,
	updateScopeStatus,
	upsertZohoTokens
} from '$lib/server/db';
import { createZohoPhase, createZohoProject, createZohoTask, createZohoTasklist, sleep } from '$lib/server/projects';
import { mapScopeToTasks } from '$lib/server/scope-mapper';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';

/**
 * Fetch the deal name from Zoho CRM for use as the project name.
 * Falls back to the dealId if the CRM call fails.
 */
async function getDealDisplayName(dealId: string): Promise<string> {
	try {
		const tokens = await getZohoTokens();
		if (!tokens) return dealId;

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

		const deal = await zohoApiCall(accessToken, '/Deals/' + dealId, { method: 'GET' }, apiDomain);
		const record = deal?.data?.[0];
		if (!record) return dealId;

		// Try Deal_Name (may be string or lookup object)
		const rawName = record.Deal_Name;
		if (typeof rawName === 'string' && rawName.trim()) return rawName.trim();
		if (rawName?.name) return rawName.name;

		// Fall back to Contact_Name
		const contact = record.Contact_Name;
		if (typeof contact === 'string' && contact.trim()) return contact.trim();
		if (contact?.name) return contact.name;

		return dealId;
	} catch (err) {
		console.warn('Failed to fetch deal name from CRM, using dealId:', err);
		return dealId;
	}
}

export interface GenerationResult {
	success: boolean;
	zohoProjectId: string | null;
	phasesCreated: number;
	tasklistsCreated: number;
	tasksCreated: number;
	tasksTotal: number;
	error?: string;
}

/**
 * Generate a Zoho Projects project from a stored scope definition and task templates.
 */
export async function generateProject(
	dealId: string,
	startDate?: string
): Promise<GenerationResult> {
	const scope = await getScopeDefinition(dealId);
	if (!scope) {
		throw new Error('No scope definition found for deal ' + dealId);
	}

	const templates = await getTaskTemplatesByProjectType(scope.project_type);
	const taskSet = mapScopeToTasks(scope, templates, startDate);
	if (taskSet.tasks.length === 0) {
		throw new Error('Scope produced zero tasks');
	}

	const genLog = await createGenerationLog({
		deal_id: dealId,
		scope_definition_id: scope.id,
		tasks_total: taskSet.summary.total_tasks
	});
	const logId = genLog?.id ?? null;

	let project: { id: string; name: string } | null = null;
	let phasesCreated = 0;
	let tasklistsCreated = 0;
	let tasksCreated = 0;
	const tasksTotal = taskSet.summary.total_tasks;
	const phaseMap = new Map<string, { zohoId: string; tasklistId: string }>();

	try {
		if (logId) await updateGenerationLog(logId, {
			status: 'creating_project',
			last_completed_step: 'starting_project_creation'
		});

		const dealName = await getDealDisplayName(dealId);
		const projectName = dealName !== dealId
			? `${dealName} - ${scope.project_type}`
			: `${dealId} - ${scope.project_type}`;

		project = await createZohoProject({
			name: projectName,
			description: 'Auto-generated from scope definition'
		});

		if (logId) await updateGenerationLog(logId, {
			zoho_project_id: project.id,
			last_completed_step: 'project:' + project.name
		});

		await sleep(200);

		if (logId) await updateGenerationLog(logId, {
			status: 'creating_phases',
			last_completed_step: 'starting_phase_creation'
		});

		for (const phase of taskSet.phases) {
			const milestone = await createZohoPhase(project.id, {
				name: phase.name,
				start_date: phase.startDate || undefined,
				end_date: phase.endDate || undefined
			});

			phaseMap.set(phase.name, { zohoId: milestone.id, tasklistId: '' });
			phasesCreated = phaseMap.size;

			if (logId) await updateGenerationLog(logId, {
				phases_created: phasesCreated,
				last_completed_step: 'phase:' + phase.name
			});

			await sleep(200);
		}

		if (logId) await updateGenerationLog(logId, {
			status: 'creating_tasklists',
			last_completed_step: 'starting_tasklist_creation'
		});

		for (const phase of taskSet.phases) {
			const entry = phaseMap.get(phase.name);
			const tasklist = await createZohoTasklist(project.id, {
				name: phase.name,
				milestone_id: entry?.zohoId
			});

			if (entry) entry.tasklistId = tasklist.id;
			tasklistsCreated++;

			if (logId) await updateGenerationLog(logId, {
				tasklists_created: tasklistsCreated,
				last_completed_step: 'tasklist:' + phase.name
			});

			await sleep(200);
		}

		if (logId) await updateGenerationLog(logId, {
			status: 'creating_tasks',
			last_completed_step: 'starting_task_creation'
		});

		for (const task of taskSet.tasks) {
			const phaseEntry = phaseMap.get(task.phase);

			if (!phaseEntry?.tasklistId) {
				console.warn('Skipping task, no tasklist for phase:', task.phase);
				continue;
			}

			const priority =
				task.requires_inspection || task.requires_client_decision ? 'high' : 'medium';

			await createZohoTask(project.id, {
				name: task.task_name,
				description: task.description || undefined,
				tasklist_id: phaseEntry.tasklistId,
				start_date: task.start_date || undefined,
				end_date: task.end_date || undefined,
				priority
			});

			tasksCreated++;

			if (logId) await updateGenerationLog(logId, {
				tasks_created: tasksCreated,
				last_completed_step: 'task:' + task.task_name
			});

			await sleep(200);
		}

		if (logId) await updateGenerationLog(logId, {
			status: 'updating_crm',
			last_completed_step: 'crm:update_deal'
		});

		try {
			const tokens = await getZohoTokens();

			if (tokens) {
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

				await zohoApiCall(
					accessToken,
					'/Deals/' + dealId,
					{
						method: 'PUT',
						body: JSON.stringify({ data: [{ Zoho_Projects_ID: project.id }] })
					},
					apiDomain
				);

				if (logId) await updateGenerationLog(logId, {
					last_completed_step: 'crm:deal_updated'
				});
			}
		} catch (err) {
			console.error('Failed to update CRM deal, continuing:', err);
		}

		for (const task of taskSet.tasks) {
			if (!task.requires_client_decision) continue;

			await createApproval({
				deal_id: dealId,
				title: 'Decision needed: ' + task.task_name,
				description: task.description,
				category: 'general',
				assigned_to: 'client',
				status: 'pending',
				priority: 'normal',
				due_date: task.start_date,
				created_by: 'generator'
			});

			if (logId) await updateGenerationLog(logId, {
				last_completed_step: 'approval:' + task.task_name
			});
		}

		await updateScopeStatus(dealId, 'generated');

		if (logId) await updateGenerationLog(logId, {
			status: 'completed',
			completed_at: new Date().toISOString(),
			tasks_created: tasksCreated
		});

		return {
			success: true,
			zohoProjectId: project.id,
			phasesCreated,
			tasklistsCreated,
			tasksCreated,
			tasksTotal
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (logId) await updateGenerationLog(logId, {
			status: 'failed',
			error_message: message,
			completed_at: new Date().toISOString(),
			tasks_created: tasksCreated
		});

		return {
			success: false,
			zohoProjectId: project?.id || null,
			phasesCreated,
			tasklistsCreated,
			tasksCreated,
			tasksTotal,
			error: message
		};
	}
}
