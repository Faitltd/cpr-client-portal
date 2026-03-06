import type { TaskTemplate, ScopeDefinition } from './db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PHASE_ORDER: Record<string, number> = {
	preconstruction: 0,
	demo: 1,
	rough: 2,
	finish: 3,
	closeout: 4
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MappedTask {
	template_id: string;
	task_name: string;
	phase: string;
	trade: string | null;
	description: string | null;
	duration_days: number;
	dependency_key: string | null;
	requires_inspection: boolean;
	requires_client_decision: boolean;
	material_lead_time_days: number;
	sort_order: number;
	is_conditional: boolean;
	condition_key: string | null;
	condition_value: string | null;
	start_date: string | null;
	end_date: string | null;
	phase_order: number;
}

export interface MappedTaskSet {
	deal_id: string;
	project_type: string;
	tasks: MappedTask[];
	phases: Array<{
		name: string;
		order: number;
		startDate: string | null;
		endDate: string | null;
		taskCount: number;
	}>;
	summary: {
		total_tasks: number;
		total_duration_days: number;
		tasks_requiring_decisions: number;
		tasks_requiring_inspections: number;
		conditional_tasks_included: number;
		conditional_tasks_excluded: number;
	};
}

// ---------------------------------------------------------------------------
// Helper: addBusinessDays
// ---------------------------------------------------------------------------

/**
 * Adds N business days to a start date, skipping Saturday and Sunday.
 * Fractional days are rounded up (e.g. 0.5 → 1).
 * If days is 0, returns the startDate unchanged.
 * @param startDate ISO date string (YYYY-MM-DD)
 * @param days      Number of business days to add (may be fractional)
 * @returns ISO date string (YYYY-MM-DD)
 */
export function addBusinessDays(startDate: string, days: number): string {
	if (days === 0) return startDate;

	const whole = Math.ceil(days);
	const date = new Date(startDate + 'T12:00:00Z'); // noon UTC to avoid DST edge cases
	let remaining = whole;

	while (remaining > 0) {
		date.setUTCDate(date.getUTCDate() + 1);
		const dow = date.getUTCDay();
		if (dow !== 0 && dow !== 6) {
			remaining--;
		}
	}

	return date.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Helper: getConditionKeysForProjectType
// ---------------------------------------------------------------------------

/**
 * Returns sorted unique condition_key values from all conditional templates.
 * Used by the scope editor UI to know which toggles to show.
 */
export function getConditionKeysForProjectType(templates: TaskTemplate[]): string[] {
	const keys = new Set<string>();
	for (const t of templates) {
		if (t.is_conditional && t.condition_key !== null) {
			keys.add(t.condition_key);
		}
	}
	return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Main export: mapScopeToTasks
// ---------------------------------------------------------------------------

/**
 * Pure function — no DB calls, no side effects.
 *
 * Takes a pre-loaded scope definition and task template list, then returns a
 * fully resolved MappedTaskSet with filtered tasks, calculated dates, phase
 * summaries, and overall counts.
 *
 * @param scope      Scope definition for the deal
 * @param templates  All active task templates for scope.project_type
 * @param startDate  Optional ISO date string for the first task (defaults to today)
 */
export function mapScopeToTasks(
	scope: ScopeDefinition,
	templates: TaskTemplate[],
	startDate?: string
): MappedTaskSet {
	// Resolve start date — default to today
	const projectStart = startDate ?? new Date().toISOString().split('T')[0];

	// -------------------------------------------------------------------------
	// Step 1 — Filter templates
	// -------------------------------------------------------------------------

	let conditionalIncluded = 0;
	let conditionalExcluded = 0;

	const included: TaskTemplate[] = [];

	for (const t of templates) {
		if (!t.is_conditional) {
			// Non-conditional tasks are always included
			included.push(t);
			continue;
		}

		// Evaluate the inclusion condition
		let include = false;

		if (t.condition_key === 'permit_required') {
			// Special boolean shorthand: include when scope.permit_required matches
			include = scope.permit_required === (t.condition_value === 'true');
		} else if (t.condition_key !== null && scope.included_items.includes(t.condition_key)) {
			// condition_key appears in the explicit included_items list
			include = true;
		} else if (
			t.condition_key !== null &&
			t.condition_key in scope.special_conditions &&
			String(scope.special_conditions[t.condition_key]) === t.condition_value
		) {
			// condition_key exists in special_conditions and the value matches
			include = true;
		}

		// Even if logically included, remove it if its condition_key is explicitly excluded
		if (include && t.condition_key !== null && scope.excluded_items.includes(t.condition_key)) {
			include = false;
		}

		if (include) {
			conditionalIncluded++;
			included.push(t);
		} else {
			conditionalExcluded++;
		}
	}

	// -------------------------------------------------------------------------
	// Step 2 — Sort included tasks
	// -------------------------------------------------------------------------
	// Primary:   PHASE_ORDER ascending
	// Secondary: sort_order ascending
	// Tertiary:  task_name alphabetical (tiebreaker)

	included.sort((a, b) => {
		const phaseA = PHASE_ORDER[a.phase] ?? 99;
		const phaseB = PHASE_ORDER[b.phase] ?? 99;
		if (phaseA !== phaseB) return phaseA - phaseB;
		if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
		return a.task_name.localeCompare(b.task_name);
	});

	// -------------------------------------------------------------------------
	// Step 3 — Calculate dates
	// -------------------------------------------------------------------------
	// Build a name→task map so dependencies can be resolved after they've been
	// date-calculated. We walk in sorted order so a dependency is always resolved
	// before the task that depends on it (assuming sane template data).

	const byName = new Map<string, MappedTask>();

	// Per-phase tracking: earliest start and latest end for the phases array
	const phaseWindows = new Map<string, { start: string; end: string; count: number }>();

	// Running "current phase start" — the date the next dependency-less task begins
	// within each phase. We advance it after each task that has no dependency.
	const phaseCurrentDate = new Map<string, string>();

	const mappedTasks: MappedTask[] = included.map((t) => {
		const phaseOrder = PHASE_ORDER[t.phase] ?? 99;

		// Determine start_date for this task
		let taskStart: string;

		if (t.dependency_key !== null && byName.has(t.dependency_key)) {
			// Start the day after the dependency finishes
			const dep = byName.get(t.dependency_key)!;
			taskStart = dep.end_date
				? addBusinessDays(dep.end_date, 1)
				: (phaseCurrentDate.get(t.phase) ?? projectStart);
		} else {
			// No dependency (or dependency was excluded): use the phase's running date
			taskStart = phaseCurrentDate.get(t.phase) ?? projectStart;
		}

		// Calculate end date
		const taskEnd = addBusinessDays(taskStart, t.default_duration_days);

		// Advance the phase's running date if this task pushes it forward
		const currentPhaseDate = phaseCurrentDate.get(t.phase) ?? projectStart;
		if (taskEnd > currentPhaseDate) {
			phaseCurrentDate.set(t.phase, taskEnd);
		}

		// Update per-phase window
		const win = phaseWindows.get(t.phase);
		if (!win) {
			phaseWindows.set(t.phase, { start: taskStart, end: taskEnd, count: 1 });
		} else {
			if (taskStart < win.start) win.start = taskStart;
			if (taskEnd > win.end) win.end = taskEnd;
			win.count++;
		}

		const mapped: MappedTask = {
			template_id: t.id,
			task_name: t.task_name,
			phase: t.phase,
			trade: t.trade,
			description: t.description,
			duration_days: t.default_duration_days,
			dependency_key: t.dependency_key,
			requires_inspection: t.requires_inspection,
			requires_client_decision: t.requires_client_decision,
			material_lead_time_days: t.material_lead_time_days,
			sort_order: t.sort_order,
			is_conditional: t.is_conditional,
			condition_key: t.condition_key,
			condition_value: t.condition_value,
			start_date: taskStart,
			end_date: taskEnd,
			phase_order: phaseOrder
		};

		// Register in the name map for downstream dependency lookups
		byName.set(t.task_name, mapped);

		return mapped;
	});

	// -------------------------------------------------------------------------
	// Step 4 — Build phases array
	// -------------------------------------------------------------------------

	const phases = [...phaseWindows.entries()]
		.map(([name, win]) => ({
			name,
			order: PHASE_ORDER[name] ?? 99,
			startDate: win.start,
			endDate: win.end,
			taskCount: win.count
		}))
		.sort((a, b) => a.order - b.order);

	// -------------------------------------------------------------------------
	// Step 5 — Build summary
	// -------------------------------------------------------------------------

	let totalDuration = 0;
	let decisionsCount = 0;
	let inspectionsCount = 0;

	for (const t of mappedTasks) {
		totalDuration += t.duration_days;
		if (t.requires_client_decision) decisionsCount++;
		if (t.requires_inspection) inspectionsCount++;
	}

	// -------------------------------------------------------------------------
	// Step 6 — Return MappedTaskSet
	// -------------------------------------------------------------------------

	return {
		deal_id: scope.deal_id,
		project_type: scope.project_type,
		tasks: mappedTasks,
		phases,
		summary: {
			total_tasks: mappedTasks.length,
			total_duration_days: totalDuration,
			tasks_requiring_decisions: decisionsCount,
			tasks_requiring_inspections: inspectionsCount,
			conditional_tasks_included: conditionalIncluded,
			conditional_tasks_excluded: conditionalExcluded
		}
	};
}
