import { json } from '@sveltejs/kit';
import { isValidAdminSession } from '$lib/server/admin';
import {
	getScopeTasksByDeal,
	getZohoTokens,
	upsertZohoTokens,
	createGenerationLog,
	updateGenerationLog,
	createApproval
} from '$lib/server/db';
import {
	createZohoProject,
	createZohoPhase,
	createZohoTasklist,
	createZohoTask,
	sleep
} from '$lib/server/projects';
import { addBusinessDays } from '$lib/server/scope-mapper';
import { refreshAccessToken, zohoApiCall } from '$lib/server/zoho';
import type { RequestHandler } from './$types';

function checkAdmin(cookies: Parameters<RequestHandler>[0]['cookies']): Response | null {
	if (!isValidAdminSession(cookies.get('admin_session'))) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	return null;
}

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const authError = checkAdmin(cookies);
	if (authError) return authError;

	let body: { start_date?: string } | undefined;
	try {
		body = await request.json();
	} catch {
		body = undefined;
	}

	const dealId = params.dealId;
	const startDate = body?.start_date || new Date().toISOString().split('T')[0];

	try {
		const scopeTasks = await getScopeTasksByDeal(dealId);
		if (scopeTasks.length === 0) {
			return json({ message: 'No scope tasks found for this deal' }, { status: 400 });
		}

		const genLog = await createGenerationLog({
			deal_id: dealId,
			tasks_total: scopeTasks.length
		});
		const logId = genLog?.id ?? null;

		let project: { id: string; name: string } | null = null;
		let phasesCreated = 0;
		let tasklistsCreated = 0;
		let tasksCreated = 0;

		// Group tasks by phase
		const phaseGroups = new Map<string, typeof scopeTasks>();
		for (const task of scopeTasks) {
			const group = phaseGroups.get(task.phase) || [];
			group.push(task);
			phaseGroups.set(task.phase, group);
		}

		// Sort phases by first appearance in the task list (preserves estimate order)
		const sortedPhases = [...phaseGroups.keys()];

		// Calculate dates for each task sequentially within phases
		const taskDates = new Map<string, { start: string; end: string }>();
		let phaseCurrentDate = startDate;

		for (const phaseName of sortedPhases) {
			const tasks = phaseGroups.get(phaseName)!;
			let currentDate = phaseCurrentDate;

			for (const task of tasks) {
				let taskStart = currentDate;

				// If task has a dependency and we have dates for it, start after it ends
				if (task.dependency_id && taskDates.has(task.dependency_id)) {
					const depDates = taskDates.get(task.dependency_id)!;
					taskStart = addBusinessDays(depDates.end, 1);
				}

				const taskEnd = addBusinessDays(taskStart, task.duration_days);
				taskDates.set(task.id, { start: taskStart, end: taskEnd });

				// Advance the running date
				if (taskEnd > currentDate) {
					currentDate = taskEnd;
				}
			}

			// Next phase starts after this one
			phaseCurrentDate = currentDate;
		}

		try {
			// Fetch deal name from CRM for proper project naming
			if (logId) await updateGenerationLog(logId, {
				status: 'creating_project',
				last_completed_step: 'fetching_deal_name'
			});

			let dealDisplayName = dealId;
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

					const dealResult = await zohoApiCall(
						accessToken,
						'/Deals/' + dealId,
						{ method: 'GET' },
						apiDomain
					);

					const deal = dealResult?.data?.[0];
					console.log('[generate] Deal_Name:', JSON.stringify(deal?.Deal_Name), 'Contact_Name:', JSON.stringify(deal?.Contact_Name));
					const rawName = deal?.Deal_Name;
					if (typeof rawName === 'string' && rawName.trim()) {
						dealDisplayName = rawName.trim();
					} else if (rawName?.name) {
						dealDisplayName = rawName.name;
					} else {
						const contact = deal?.Contact_Name;
						if (typeof contact === 'string' && contact.trim()) {
							dealDisplayName = contact.trim();
						} else if (contact?.name) {
							dealDisplayName = contact.name;
						}
					}
				}
			} catch (err) {
				console.error('Failed to fetch deal name, using dealId:', err);
			}

			const projectName = dealDisplayName;
			console.log('[generate] Creating new project:', projectName);

			project = await createZohoProject({
				name: projectName,
				description: 'Generated from scope builder'
			});

			if (logId) await updateGenerationLog(logId, {
				zoho_project_id: project.id,
				last_completed_step: 'project:' + project.name
			});

			await sleep(200);

			// Create milestones per phase
			if (logId) await updateGenerationLog(logId, {
				status: 'creating_phases',
				last_completed_step: 'starting_phase_creation'
			});

			const phaseMap = new Map<string, { zohoId: string; tasklistId: string }>();

			for (const phaseName of sortedPhases) {
				const tasks = phaseGroups.get(phaseName)!;
				const firstTask = tasks[0];
				const lastTask = tasks[tasks.length - 1];
				const phaseStart = taskDates.get(firstTask.id)?.start;
				const phaseEnd = taskDates.get(lastTask.id)?.end;

				const milestone = await createZohoPhase(project.id, {
					name: phaseName.charAt(0).toUpperCase() + phaseName.slice(1),
					start_date: phaseStart,
					end_date: phaseEnd
				});

				phaseMap.set(phaseName, { zohoId: milestone.id, tasklistId: '' });
				phasesCreated++;

				if (logId) await updateGenerationLog(logId, {
					phases_created: phasesCreated,
					last_completed_step: 'phase:' + phaseName
				});

				await sleep(200);
			}

			// Create tasklists per phase
			if (logId) await updateGenerationLog(logId, {
				status: 'creating_tasklists',
				last_completed_step: 'starting_tasklist_creation'
			});

			for (const phaseName of sortedPhases) {
				const entry = phaseMap.get(phaseName);
				const tasklist = await createZohoTasklist(project.id, {
					name: phaseName.charAt(0).toUpperCase() + phaseName.slice(1),
					milestone_id: entry?.zohoId
				});

				if (entry) entry.tasklistId = tasklist.id;
				tasklistsCreated++;

				if (logId) await updateGenerationLog(logId, {
					tasklists_created: tasklistsCreated,
					last_completed_step: 'tasklist:' + phaseName
				});

				await sleep(200);
			}

			// Create tasks
			if (logId) await updateGenerationLog(logId, {
				status: 'creating_tasks',
				last_completed_step: 'starting_task_creation'
			});

			for (const phaseName of sortedPhases) {
				const tasks = phaseGroups.get(phaseName)!;
				const phaseEntry = phaseMap.get(phaseName);

				if (!phaseEntry?.tasklistId) continue;

				for (const task of tasks) {
					const dates = taskDates.get(task.id);
					const priority =
						task.requires_inspection || task.requires_client_decision ? 'high' : 'medium';

					await createZohoTask(project.id, {
						name: task.task_name,
						description: task.description || undefined,
						tasklist_id: phaseEntry.tasklistId,
						start_date: dates?.start,
						end_date: dates?.end,
						priority
					});

					tasksCreated++;

					if (logId) await updateGenerationLog(logId, {
						tasks_created: tasksCreated,
						last_completed_step: 'task:' + task.task_name
					});

					await sleep(200);
				}
			}

			// Update CRM deal with project ID
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
							body: JSON.stringify({ data: [{ Project_ID: project.id }] })
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

			// Create client approvals for tasks requiring decisions
			try {
				for (const task of scopeTasks) {
					if (!task.requires_client_decision) continue;

					const dates = taskDates.get(task.id);
					await createApproval({
						deal_id: dealId,
						title: 'Decision needed: ' + task.task_name,
						description: task.description,
						category: 'general',
						assigned_to: 'client',
						status: 'pending',
						priority: 'normal',
						due_date: dates?.start || null,
						created_by: 'scope-builder'
					});

					if (logId) await updateGenerationLog(logId, {
						last_completed_step: 'approval:' + task.task_name
					});
				}
			} catch (err) {
				console.error('Failed to create approvals, continuing:', err);
			}

			if (logId) await updateGenerationLog(logId, {
				status: 'completed',
				completed_at: new Date().toISOString(),
				tasks_created: tasksCreated
			});

			return json({
				data: {
					success: true,
					zohoProjectId: project.id,
					phasesCreated,
					tasklistsCreated,
					tasksCreated,
					tasksTotal: scopeTasks.length
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			if (logId) await updateGenerationLog(logId, {
				status: 'failed',
				error_message: message,
				completed_at: new Date().toISOString(),
				tasks_created: tasksCreated
			});

			return json({
				data: {
					success: false,
					zohoProjectId: project?.id || null,
					phasesCreated,
					tasklistsCreated,
					tasksCreated,
					tasksTotal: scopeTasks.length,
					error: message
				}
			}, { status: 500 });
		}
	} catch (err) {
		console.error('POST /api/admin/scope-tasks/[dealId]/generate error:', err);
		const message = err instanceof Error ? err.message : 'Failed to generate project';
		return json({ message }, { status: 500 });
	}
};
