<svelte:head>
	<title>Process Map — CPR Admin</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<script>
	import { onMount, onDestroy } from 'svelte';

	const PHASES = [
		{
			name: "Phase 1: Lead Intake & Qualification",
			key: "phase_1",
			color: "#0A6B74",
			steps: [
				{ code: "NL", name: "New Lead", pct: "", type: "Standard", outcomes: [],
					automations: ["Blueprint: Lead Nurturing entry (status = New Lead)", "Ray reviews and qualifies incoming leads"] },
				{ code: "DC", name: "Discovery Call Booked", pct: "", type: "Standard", outcomes: [],
					automations: ["Bookings > Flow > CRM: status auto-updated", "HWWWY Email auto-sent (WF #15)", "Resend Discovery Call Link (Blueprint, triggered manually)", "Notify Jeff via Cliq on discovery call (WF #26)", "Blueprint reminder sequence initiated"] },
				{ code: "CC", name: "Discovery Call Conducted", pct: "", type: "Standard", outcomes: [],
					automations: ["Ray manually logs discovery call notes on lead record", "Update Lead Stage based on Meeting Title (WF #25)", "Update Data Of Lead/Deal On Meeting (WF #29)"] },
				{ code: "SV", name: "Site Visit Needed", pct: "", type: "Standard", outcomes: [],
					automations: ["Blueprint auto-transition from Discovery Call", "Scheduling task/reminder auto-created"] },
				{ code: "SB", name: "Site Visit Booked", pct: "", type: "Standard", outcomes: [],
					automations: ["Bookings > Flow > CRM: status auto-updated", "Site Visit Booked Email auto-sent (WF #19)", "Resend Site Visit Link (Blueprint, triggered manually)", "Site Visit Update: field update on meeting (WF #17)"] },
				{ code: "SC", name: "Site Visit Conducted", pct: "", type: "Standard", outcomes: [],
					automations: ["Ray manually logs site visit notes on lead record", "Update Data Of Lead/Deal On Meeting (WF #29)"] },
				{ code: "QD", name: "Qualification Decision", pct: "", type: "Decision",
					outcomes: [
						{ text: "Qualified > Converts to Deal (handoff from Ray to Mary Sue)", color: "#247040" },
						{ text: "Pending / Undecided > Follow-up task (Ray)", color: "#555" },
						{ text: "Referred Out > Record closed", color: "#B52A23" },
						{ text: "Unqualified / Lost > Record closed", color: "#B52A23" }
					],
					automations: ["Lead > Deal conversion on Qualified (CRM)", "Blueprint transitions for all outcomes", "Ray owns entire Leads module through qualification"] }
			]
		},
		{
			name: "Phase 2: Ballpark & PDA",
			key: "phase_2",
			color: "#C56D14",
			steps: [
				{ code: "BN", name: "Ballpark Needed", pct: "10%", type: "Standard", outcomes: [],
					automations: ["Mary Sue receives deal from Ray after qualification", "Create MSM Task: 'needs their Ballpark' (WF #3)", "Blueprint: Deal Sales Journey entry criteria", "Task auto-synced to Jeff's calendar (WF #13)", "Task owner notified via Cliq (WF #24)", "Task due date auto-set (WF #21)"] },
				{ code: "BV", name: "Ballpark Revision", pct: "20%", type: "Revision Loop", outcomes: [],
					automations: ["Triggered when client requests changes", "Updates original ballpark document", "Loops back to Ballpark Review Needed"] },
				{ code: "BR", name: "Ballpark Review Needed", pct: "20%", type: "Standard", outcomes: [],
					automations: ["BP Task Completed > stage auto-update (WF #2)", "BPRN>BPRB: meeting auto-moves stage (WF #20)", "Resend Ballpark Review Link (Blueprint)"] },
				{ code: "BB", name: "Ballpark Review Booked", pct: "40%", type: "Decision",
					outcomes: [
						{ text: "Accept > PDA Needed", color: "#247040" },
						{ text: "Revise > Ballpark Revision (20%)", color: "#C56D14" },
						{ text: "Lost > Deal closed (0%)", color: "#B52A23" }
					],
					automations: ["Notify Jeff via Cliq on stage change (WF #8)", "Meeting data synced to deal record (WF #29)"] },
				{ code: "PN", name: "PDA Needed", pct: "40%", type: "Standard", outcomes: [],
					automations: ["June Task: 'PDA is needed' task created (WF #27)", "Task auto-synced to Jeff's calendar (WF #13)"] },
				{ code: "PS", name: "PDA Sent", pct: "40%", type: "Standard", outcomes: [],
					automations: ["PDA via Zoho Sign for e-signature", "Day 3: PDA Follow Up Email #1 (WF #14)", "Day 7: PDA Follow Up Email #2 (WF #16)", "PDA Signed > stage to Design Needed (WF #7)", "PDA Signed creates tasks: Client Info, Quotes (WF #7)"] }
			]
		},
		{
			name: "Phase 3: Design",
			key: "phase_3",
			color: "#C56D14",
			steps: [
				{ code: "DN", name: "Design Needed", pct: "40%", type: "Standard", outcomes: [],
					automations: ["Matterport 3D scan linked if used", "Design files saved to WorkDrive", "Attachment Manager Widget active on deal"] },
				{ code: "RD", name: "Redesign Needed", pct: "30%", type: "Revision Loop", outcomes: [],
					automations: ["Triggered when design review requires changes", "Loops back through design revision cycle"] },
				{ code: "DR", name: "Design Review Needed", pct: "40%", type: "Standard", outcomes: [],
					automations: ["Design Task Completion > stage auto-update (WF #6)", "Design Review Booked: Create Est Task (WF #18)", "Resend Design Review Link (Blueprint)"] },
				{ code: "DB", name: "Design Review Booked", pct: "40%", type: "Decision",
					outcomes: [
						{ text: "Approve > Estimate Needed", color: "#247040" },
						{ text: "Revise > Redesign Needed (30%)", color: "#C56D14" },
						{ text: "Lost > Deal closed (0%)", color: "#B52A23" }
					],
					automations: ["Meeting data synced to deal record (WF #29)", "Appointment Canceled handler (Blueprint)"] }
			]
		},
		{
			name: "Phase 4: Estimate & Contract",
			key: "phase_4",
			color: "#C56D14",
			steps: [
				{ code: "EN", name: "Estimate Needed", pct: "40%", type: "Standard", outcomes: [],
					automations: ["Estimate created in Zoho Books > linked to deal", "Task auto-synced to Jeff's calendar (WF #13)", "Task owner notified via Cliq (WF #24)"] },
				{ code: "EV", name: "Estimate Revision Needed", pct: "50%", type: "Revision Loop", outcomes: [],
					automations: ["Triggered when quoted estimate needs changes", "Revised estimate prepared in Zoho Books", "Loops back to Estimate Review Needed"] },
				{ code: "ER", name: "Estimate Review Needed", pct: "50%", type: "Standard", outcomes: [],
					automations: ["Estimate Task Completion > stage update (WF #10)", "Resend Estimate Review Link (Blueprint)"] },
				{ code: "EB", name: "Estimate Review Booked", pct: "50%", type: "Standard", outcomes: [],
					automations: ["Meeting data synced to deal record (WF #29)", "Appointment Canceled handler (Blueprint)"] },
				{ code: "QT", name: "Quoted", pct: "50%", type: "Decision",
					outcomes: [
						{ text: "Accept > Contract Needed", color: "#247040" },
						{ text: "Revise > Estimate Revision Needed (50%)", color: "#C56D14" },
						{ text: "Lost > Deal closed (0%)", color: "#B52A23" }
					],
					automations: ["Quote Follow-Up email: +1 day at 8am (WF #22)"] },
				{ code: "CN", name: "Contract Needed", pct: "80%", type: "Standard", outcomes: [],
					automations: ["Blueprint transition to Contract Sent", "Contract drafted in Zoho Sign"] },
				{ code: "CS", name: "Contract Sent", pct: "80%", type: "Decision",
					outcomes: [
						{ text: "Signed > Project Created (100%)", color: "#247040" },
						{ text: "Lost > Deal closed (0%)", color: "#B52A23" }
					],
					automations: ["Contract via Zoho Sign for e-signature", "Day 1: Follow-up email + task (WF #23)", "Day 3: Follow-up email #2 (WF #23 scheduled)", "Day 5: Follow-up email #3 (WF #23 scheduled)", "Contract Signed > Project Created (WF #12)"] }
			]
		},
		{
			name: "Phase 5: Pre-Construction Setup",
			key: "phase_5",
			color: "#243A54",
			steps: [
				{ code: "PC", name: "Project Created", pct: "100%", type: "Standard", outcomes: [],
					automations: ["Create WD Folders: folder structure + links (Function)", "Create Project from Scope: phases & tasks (Function)", "Create Cliq Channel: internal comms (Function)", "Client Portal: access provisioned (Hetzner > WD API)", "Field Update > Cliq Notification (WF #5)", "Attachment Manager Widget activated on deal"] },
				{ code: "TP", name: "Trade Partner Assignment", pct: "", type: "Standard", outcomes: [],
					automations: ["Trade partners linked to deal & project tasks", "Insurance Expiry reminders active (WF #4)", "Work Comp Expiry reminders active (WF #9)", "License Expiry reminders active (WF #11)"] },
				{ code: "PM", name: "Permits & Pre-Con Checklist", pct: "", type: "Standard", outcomes: [],
					automations: ["Documents stored in WorkDrive Permits folder", "Pre-con checklist tracked in Zoho Projects"] }
			]
		},
		{
			name: "Phase 6: Project Execution",
			key: "phase_6",
			color: "#247040",
			steps: [
				{ code: "DP", name: "Demo & Prep", pct: "3 days", type: "Standard", outcomes: [],
					automations: ["Field Update > Cliq Notification (WF #5 / Flow)", "Client Portal: progress visible to client", "Scope change > Project Regeneration (Function)"] },
				{ code: "RT", name: "Rough Trades", pct: "7 days", type: "Standard", outcomes: [],
					automations: ["Field Update > Cliq Notification (WF #5 / Flow)", "Client Portal: progress visible to client", "Inspections documented in WD Permits folder"] },
				{ code: "FN", name: "Finishes", pct: "7 days", type: "Standard", outcomes: [],
					automations: ["Field Update > Cliq Notification (WF #5 / Flow)", "Client Portal: progress visible to client", "Progress photos uploaded to WD Field Updates"] },
				{ code: "FL", name: "Flooring", pct: "3 days", type: "Standard", outcomes: [],
					automations: ["Field Update > Cliq Notification (WF #5 / Flow)", "Client Portal: progress visible to client"] },
				{ code: "CM", name: "Completion", pct: "3 days", type: "Standard", outcomes: [],
					automations: ["Field Update > Cliq Notification (WF #5 / Flow)", "Client Portal: progress visible to client", "Final inspection docs in WD Permits folder", "Deal Stagnation monitoring active (Blueprint / WF)"] }
			]
		},
		{
			name: "Phase 7: Completion & Handoff",
			key: "phase_7",
			color: "#7A2845",
			steps: [
				{ code: "FW", name: "Final Walkthrough", pct: "", type: "Standard", outcomes: [],
					automations: ["Client Portal: final status visible"] },
				{ code: "PL", name: "Punch List Resolution", pct: "", type: "Standard", outcomes: [],
					automations: ["Tasks tracked in Zoho Projects", "Task owner notified via Cliq (WF #24)"] },
				{ code: "FI", name: "Final Invoice", pct: "", type: "Standard", outcomes: [],
					automations: ["Invoice generated via Zoho Books"] },
				{ code: "DC2", name: "Document Close-Out", pct: "", type: "Standard", outcomes: [],
					automations: ["All files confirmed in WorkDrive folders", "Client Portal updated to completion status"] },
				{ code: "CO", name: "Deal Completed", pct: "100%", type: "Standard", outcomes: [],
					automations: ["Post-project automations fire (Zoho Flow > CRM)", "Cliq project channel archived (Zoho Cliq)", "Project archived in Zoho Projects"] },
				{ code: "PF", name: "Post-Project Follow-Up", pct: "", type: "Standard", outcomes: [],
					automations: ["Review request / satisfaction follow-up sent", "Referral tracking noted on lead record"] }
			]
		},
		{
			name: "Exit Paths",
			key: "exit_paths",
			color: "#B52A23",
			steps: [
				{ code: "OH", name: "On Hold", pct: "10%", type: "Exit", outcomes: [],
					automations: ["Deal paused — no active automations", "Stagnation monitoring may trigger follow-up", "Can be reactivated to any prior stage"] },
				{ code: "LT", name: "Lost", pct: "0%", type: "Exit", outcomes: [],
					automations: ["Deal closed as lost — all tasks deactivated", "Loss reason recorded on deal record", "Blueprint marks deal as terminal"] }
			]
		},
		{
			name: "Change Order Process",
			key: "change_order",
			color: "#5C4090",
			steps: [
				{ code: "CI", name: "Change Identified", pct: "", type: "Standard", outcomes: [],
					automations: ["Client request or field-discovered issue"] },
				{ code: "SA", name: "Scope Assessment", pct: "", type: "Standard", outcomes: [],
					automations: ["PM evaluates schedule & budget impact"] },
				{ code: "CSI", name: "Cost & Schedule Impact", pct: "", type: "Standard", outcomes: [],
					automations: ["Revised estimate prepared in Zoho Books"] },
				{ code: "CD", name: "Change Order Document", pct: "", type: "Standard", outcomes: [],
					automations: ["Formal CO created and sent to client"] },
				{ code: "CA", name: "Client Approval", pct: "", type: "Decision",
					outcomes: [
						{ text: "Approved > Scope Updated", color: "#247040" },
						{ text: "Rejected > Revise or cancel CO", color: "#B52A23" }
					],
					automations: ["Client reviews and signs CO"] },
				{ code: "SU", name: "Scope Updated", pct: "", type: "Standard", outcomes: [],
					automations: ["Refined_Scope field updated on deal record", "Field Update > Cliq Notification (WF #5)"] },
				{ code: "PR", name: "Project Regenerated", pct: "", type: "Standard", outcomes: [],
					automations: ["'Create Project from Scope' re-fires (Function)", "Existing tasklists deleted & rebuilt (Zoho Projects)", "Waterfall dates recalculated automatically"] }
			]
		},
		{
			name: "Cross-Cutting Automations",
			key: "cross_cutting",
			color: "#2D2D2D",
			steps: [
				{ code: "JC", name: "Jeff Tasks to Calendar", pct: "All phases", type: "Standard", outcomes: [],
					automations: ["Every task created/edited syncs to Jeff's calendar via addTaskToCalendar (WF #13)"] },
				{ code: "TN", name: "Task Notifications", pct: "All phases", type: "Standard", outcomes: [],
					automations: ["Task owner notified via Cliq (WF #24)", "Task due date auto-set (WF #21)"] },
				{ code: "TR", name: "Trade Partner Reminders", pct: "Monthly", type: "Standard", outcomes: [],
					automations: ["Insurance Expiry: 1 month before (WF #4)", "Work Comp Expiry: 1 month before (WF #9)", "License Expiry: 1 month before (WF #11)"] }
			]
		}
	];

	const INTEGRATIONS = [
		"Zoho CRM", "Zoho Projects", "Zoho Books", "Zoho Sign",
		"Zoho WorkDrive", "Zoho Bookings", "Zoho Cliq", "Zoho Flow",
		"n8n", "Matterport", "Client Portal (Hetzner)"
	];

	const totalSteps = PHASES.reduce((sum, p) => sum + p.steps.length, 0);

	let allExpanded = false;
	let searchQuery = '';
	let phaseFilterValue = 'all';

	/** Persisted notes keyed by step code */
	let notes = {};
	let saveTimers = {};
	let saveStatus = {};

	async function loadNotes() {
		try {
			const res = await fetch('/api/admin/process-map-notes');
			if (res.ok) {
				const json = await res.json();
				notes = json.data ?? {};
			}
		} catch (e) {
			console.error('Failed to load process map notes', e);
		}
	}

	function saveNote(stepCode) {
		if (saveTimers[stepCode]) clearTimeout(saveTimers[stepCode]);
		saveStatus[stepCode] = 'saving';
		saveTimers[stepCode] = setTimeout(async () => {
			try {
				const res = await fetch('/api/admin/process-map-notes', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ stepCode, note: notes[stepCode] ?? '' })
				});
				saveStatus[stepCode] = res.ok ? 'saved' : 'error';
			} catch {
				saveStatus[stepCode] = 'error';
			}
			saveStatus = saveStatus;
			setTimeout(() => {
				if (saveStatus[stepCode] === 'saved') {
					saveStatus[stepCode] = '';
					saveStatus = saveStatus;
				}
			}, 2000);
		}, 600);
	}

	function handleNoteInput(stepCode, event) {
		notes[stepCode] = event.target.value;
		notes = notes;
		saveNote(stepCode);
	}

	onDestroy(() => {
		Object.values(saveTimers).forEach(t => clearTimeout(t));
	});

	function getTypeIcon(type) {
		switch (type) {
			case 'Decision': return '\u25C6';
			case 'Revision Loop': return '\u21BB';
			case 'Exit': return '\u2B22';
			default: return '';
		}
	}

	function hexToRGBA(hex, alpha) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${alpha})`;
	}

	function toggleCard(event, code) {
		if (event.target.closest('.team-notes')) return;
		const card = event.currentTarget.closest('.step-card');
		const body = card.querySelector('.card-body');
		if (card.classList.contains('expanded')) {
			body.style.maxHeight = '0px';
			card.classList.remove('expanded');
		} else {
			card.classList.add('expanded');
			body.style.maxHeight = body.scrollHeight + 200 + 'px';
		}
	}

	function toggleAll() {
		allExpanded = !allExpanded;
		const cards = document.querySelectorAll('.step-card');
		cards.forEach(card => {
			const body = card.querySelector('.card-body');
			if (allExpanded) {
				card.classList.add('expanded');
				body.style.maxHeight = body.scrollHeight + 200 + 'px';
			} else {
				card.classList.remove('expanded');
				body.style.maxHeight = '0px';
			}
		});
	}

	function matchesSearch(step) {
		if (!searchQuery.trim()) return true;
		const q = searchQuery.toLowerCase();
		return step.name.toLowerCase().includes(q) ||
			step.automations.some(a => a.toLowerCase().includes(q));
	}

	function phaseHasVisibleSteps(phase) {
		return phase.steps.some(s => matchesSearch(s));
	}

	function isPhaseVisible(phase) {
		if (phaseFilterValue !== 'all' && phase.key !== phaseFilterValue) return false;
		return phaseHasVisibleSteps(phase);
	}

	function isPhaseDimmed(phase) {
		return phaseFilterValue !== 'all' && phase.key !== phaseFilterValue;
	}

	$: matchCount = searchQuery.trim()
		? PHASES.reduce((sum, p) => sum + p.steps.filter(s => matchesSearch(s)).length, 0)
		: 0;

	onMount(() => {
		loadNotes();
		applyArrows();
		window.addEventListener('resize', applyArrows);
		return () => window.removeEventListener('resize', applyArrows);
	});

	function applyArrows() {
		const grids = document.querySelectorAll('.card-grid');
		grids.forEach(grid => {
			grid.querySelectorAll('.card-grid-item').forEach(item => {
				item.classList.remove('has-arrow-right', 'has-arrow-down', 'has-line-right', 'has-line-down');
			});

			const items = Array.from(grid.querySelectorAll('.card-grid-item:not(.hidden)'));
			const phaseSection = grid.closest('.phase-section');
			if (!phaseSection) return;
			const phaseKey = phaseSection.dataset.phaseKey;
			const phase = PHASES.find(p => p.key === phaseKey);
			if (!phase) return;
			const arrowColor = hexToRGBA(phase.color, 0.4);

			const gridStyle = getComputedStyle(grid);
			const cols = gridStyle.gridTemplateColumns.split(' ').length;

			items.forEach((item, idx) => {
				item.style.removeProperty('--arrow-color');
				const isLast = idx === items.length - 1;
				const colPos = idx % cols;
				const isEndOfRow = colPos === cols - 1;

				item.style.setProperty('--arrow-color', arrowColor);

				if (!isLast) {
					if (!isEndOfRow) {
						item.classList.add('has-arrow-right', 'has-line-right');
					} else {
						item.classList.add('has-arrow-down', 'has-line-down');
					}
				}
			});
		});
	}

	$: if (typeof document !== 'undefined') {
		searchQuery;
		phaseFilterValue;
		setTimeout(applyArrows, 0);
	}
</script>

<div class="process-map">
	<div class="pm-header">
		<h1>CPR Client Process Map</h1>
		<p class="subtitle">Interactive team reference — expand steps to see automations, flag bottlenecks</p>
		<p class="step-count">{totalSteps} steps across {PHASES.length} phases</p>
	</div>

	<div class="controls-bar">
		<select bind:value={phaseFilterValue} aria-label="Filter by phase">
			<option value="all">All Phases</option>
			{#each PHASES as phase}
				<option value={phase.key}>{phase.name}</option>
			{/each}
		</select>
		<div class="search-wrap">
			<input type="text" bind:value={searchQuery} placeholder="Search steps & automations..." aria-label="Search steps">
		</div>
		{#if searchQuery.trim()}
			<span class="search-count">{matchCount} of {totalSteps} steps match</span>
		{/if}
		<button class="btn-toggle" on:click={toggleAll}>
			{allExpanded ? 'Collapse All' : 'Expand All'}
		</button>
	</div>

	<div class="main-content">
		{#each PHASES as phase}
			{#if phaseFilterValue === 'all' || phase.key === phaseFilterValue}
				<div class="phase-section" class:dimmed={isPhaseDimmed(phase)} data-phase-key={phase.key}
					style:display={phaseHasVisibleSteps(phase) ? '' : 'none'}>
					<div class="phase-header" style="background: {hexToRGBA(phase.color, 0.08)}; border-left-color: {phase.color}; color: {phase.color};">
						{phase.name}
					</div>

					<div class="card-grid">
						{#each phase.steps as step}
							<div class="card-grid-item" class:hidden={!matchesSearch(step)}>
								<div class="step-card" data-code={step.code}>
									<div class="card-accent" style="background: {phase.color};"></div>

									<div class="card-header" on:click={(e) => toggleCard(e, step.code)}>
										<div class="card-code-circle" style="background: {phase.color};">
											{step.code.substring(0, 3)}
										</div>
										<div class="card-info">
											<div class="card-name">
												<span class="card-name-text">{step.name}</span>
												{#if getTypeIcon(step.type)}
													<span class="type-icon" title={step.type}>{getTypeIcon(step.type)}</span>
												{/if}
											</div>
											{#if step.pct}
												<span class="pct-badge" style="background: {hexToRGBA(phase.color, 0.12)}; color: {phase.color};">
													{step.pct}
												</span>
											{/if}
										</div>
										<span class="card-chevron">&#9656;</span>
									</div>

									<div class="card-body">
										<div class="card-body-inner">
											{#if step.automations.length > 0}
												<div class="automations-title">Automations</div>
												<ul class="automation-list">
													{#each step.automations as auto}
														<li style="--dot-color: {phase.color};">
															<span class="auto-text">{auto}</span>
														</li>
													{/each}
												</ul>
											{/if}

											{#if step.outcomes && step.outcomes.length > 0}
												<div class="outcomes-title">Outcomes</div>
												<ul class="outcome-list">
													{#each step.outcomes as outcome}
														<li>
															<span class="outcome-arrow" style="color: {outcome.color};">&#8594;</span>
															<span style="color: {outcome.color};">{outcome.text}</span>
														</li>
													{/each}
												</ul>
											{/if}

											<div class="notes-title">
												Team Notes
												{#if saveStatus[step.code] === 'saving'}
													<span class="save-indicator saving">Saving...</span>
												{:else if saveStatus[step.code] === 'saved'}
													<span class="save-indicator saved">Saved</span>
												{:else if saveStatus[step.code] === 'error'}
													<span class="save-indicator error">Save failed</span>
												{/if}
											</div>
											<textarea class="team-notes"
												placeholder="Add observations, bottlenecks, or improvement ideas..."
												value={notes[step.code] ?? ''}
												on:input={(e) => handleNoteInput(step.code, e)}
												on:click|stopPropagation
											></textarea>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	</div>

	<div class="integrations-bar">
		<h3>Connected Integrations</h3>
		<div class="integration-tags">
			{#each INTEGRATIONS as name}
				<span class="integration-tag">{name}</span>
			{/each}
		</div>
	</div>

	<div class="page-footer">
		CPR — Custom Professional Renovation | Process Map
	</div>
</div>

<style>
	.process-map {
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
		line-height: 1.5;
	}

	/* === HEADER === */
	.pm-header {
		text-align: center;
		padding: 40px 24px 24px;
	}
	.pm-header h1 {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.5px;
		color: #1A1A1A;
		margin-bottom: 6px;
	}
	.subtitle {
		font-size: 15px;
		color: #555;
		margin-bottom: 4px;
	}
	.step-count {
		font-size: 13px;
		color: #888;
		font-weight: 500;
	}

	/* === CONTROLS BAR === */
	.controls-bar {
		position: sticky;
		top: 56px;
		z-index: 50;
		background: #fff;
		border-bottom: 1px solid #E0DED8;
		padding: 12px 24px;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.controls-bar select {
		font-family: inherit;
		font-size: 14px;
		padding: 8px 32px 8px 12px;
		border: 1px solid #E0DED8;
		border-radius: 6px;
		background: #fff;
		appearance: none;
		cursor: pointer;
		min-width: 180px;
		color: #1A1A1A;
	}
	.controls-bar select:focus {
		outline: none;
		border-color: #0A6B74;
		box-shadow: 0 0 0 2px rgba(10,107,116,0.15);
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 200px;
		max-width: 360px;
	}
	.search-wrap input {
		font-family: inherit;
		font-size: 14px;
		width: 100%;
		padding: 8px 12px 8px 34px;
		border: 1px solid #E0DED8;
		border-radius: 6px;
		background: #fff;
		color: #1A1A1A;
	}
	.search-wrap input:focus {
		outline: none;
		border-color: #0A6B74;
		box-shadow: 0 0 0 2px rgba(10,107,116,0.15);
	}
	.search-wrap::before {
		content: '';
		position: absolute;
		left: 11px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat center;
		pointer-events: none;
	}
	.search-count {
		font-size: 12px;
		color: #888;
		white-space: nowrap;
		font-weight: 500;
	}
	.btn-toggle {
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 8px 16px;
		border: 1px solid #E0DED8;
		border-radius: 6px;
		background: #fff;
		color: #555;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.25s ease;
	}
	.btn-toggle:hover {
		background: #f5f5f2;
		border-color: #ccc;
	}

	/* === MAIN CONTENT === */
	.main-content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px;
	}

	/* === PHASE SECTION === */
	.phase-section {
		margin-bottom: 40px;
		transition: opacity 0.3s ease;
	}
	.phase-section.dimmed {
		opacity: 0.2;
		pointer-events: none;
	}
	.phase-header {
		display: flex;
		align-items: center;
		padding: 14px 20px;
		border-radius: 8px;
		margin-bottom: 20px;
		font-size: 17px;
		font-weight: 700;
		border-left: 4px solid;
	}

	/* === CARD GRID === */
	.card-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		position: relative;
	}
	@media (max-width: 1024px) {
		.card-grid { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 768px) {
		.card-grid { grid-template-columns: 1fr; }
	}

	/* === STEP CARD === */
	.step-card {
		background: #FAFAF8;
		border-radius: 8px;
		border: 1px solid #E0DED8;
		overflow: hidden;
		transition: box-shadow 0.25s ease, transform 0.25s ease;
		position: relative;
	}
	.step-card:hover {
		box-shadow: 0 6px 20px rgba(0,0,0,0.12);
		transform: translateY(-2px);
	}

	.card-accent {
		height: 4px;
		width: 100%;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 16px 12px;
		cursor: pointer;
		user-select: none;
	}
	.card-code-circle {
		width: 40px;
		height: 40px;
		min-width: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 13px;
		font-weight: 700;
		color: #fff;
	}
	.card-info {
		flex: 1;
		min-width: 0;
	}
	.card-name {
		font-size: 14px;
		font-weight: 600;
		color: #1A1A1A;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.type-icon {
		font-size: 13px;
		opacity: 0.7;
	}
	.pct-badge {
		display: inline-block;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 12px;
		margin-top: 4px;
		white-space: nowrap;
	}
	.card-chevron {
		font-size: 14px;
		color: #888;
		transition: transform 0.25s ease;
		min-width: 16px;
		text-align: center;
	}
	:global(.step-card.expanded) .card-chevron {
		transform: rotate(90deg);
	}

	/* Card body (expandable) */
	.card-body {
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.35s ease;
	}
	.card-body-inner {
		padding: 0 16px 16px;
		border-top: 1px solid #E0DED8;
	}

	.automations-title, .outcomes-title, .notes-title {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #888;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.save-indicator {
		font-size: 10px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}
	.save-indicator.saving { color: #888; }
	.save-indicator.saved { color: #247040; }
	.save-indicator.error { color: #B52A23; }
	.automations-title { margin: 12px 0 8px; }
	.outcomes-title { margin: 12px 0 8px; }
	.notes-title { margin: 16px 0 6px; }

	.automation-list {
		list-style: none;
		padding: 0;
	}
	.automation-list li {
		font-size: 13px;
		color: #555;
		padding: 3px 0;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		line-height: 1.45;
	}
	.automation-list li::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		min-width: 6px;
		border-radius: 50%;
		margin-top: 6px;
		background: var(--dot-color, #888);
	}

	.outcome-list {
		list-style: none;
		padding: 0;
	}
	.outcome-list li {
		font-size: 13px;
		padding: 4px 0;
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 500;
	}
	.outcome-arrow {
		font-size: 14px;
		font-weight: 700;
	}

	.team-notes {
		width: 100%;
		font-family: inherit;
		font-size: 13px;
		padding: 8px 10px;
		border: 1px solid #E0DED8;
		border-radius: 6px;
		background: #fff;
		color: #1A1A1A;
		resize: vertical;
		min-height: 60px;
		line-height: 1.45;
	}
	.team-notes:focus {
		outline: none;
		border-color: #0A6B74;
		box-shadow: 0 0 0 2px rgba(10,107,116,0.12);
	}

	/* === CSS ARROW CONNECTORS === */
	.card-grid-item {
		position: relative;
	}
	.hidden {
		display: none;
	}
	:global(.card-grid-item.has-arrow-right)::after {
		content: '';
		position: absolute;
		right: -14px;
		top: 50%;
		width: 8px;
		height: 8px;
		border-right: 2px dashed;
		border-top: 2px dashed;
		transform: translateY(-50%) rotate(45deg);
		z-index: 1;
		border-color: var(--arrow-color, rgba(0,0,0,0.2));
	}
	:global(.card-grid-item.has-arrow-down)::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -14px;
		width: 8px;
		height: 8px;
		border-right: 2px dashed;
		border-top: 2px dashed;
		transform: translateX(-50%) rotate(135deg);
		z-index: 1;
		border-color: var(--arrow-color, rgba(0,0,0,0.2));
	}
	:global(.card-grid-item.has-line-right)::before {
		content: '';
		position: absolute;
		right: -20px;
		top: 50%;
		width: 20px;
		height: 0;
		border-top: 2px dashed;
		z-index: 0;
		border-color: var(--arrow-color, rgba(0,0,0,0.2));
	}
	:global(.card-grid-item.has-line-down)::before {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -20px;
		height: 20px;
		width: 0;
		border-left: 2px dashed;
		z-index: 0;
		border-color: var(--arrow-color, rgba(0,0,0,0.2));
	}

	/* === INTEGRATIONS FOOTER === */
	.integrations-bar {
		max-width: 1200px;
		margin: 10px auto 0;
		padding: 20px 24px;
		border-top: 1px solid #E0DED8;
	}
	.integrations-bar h3 {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		color: #888;
		margin-bottom: 10px;
	}
	.integration-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.integration-tag {
		font-size: 12px;
		font-weight: 500;
		padding: 4px 12px;
		border-radius: 20px;
		background: #fff;
		color: #555;
		border: 1px solid #E0DED8;
	}

	.page-footer {
		text-align: center;
		padding: 24px;
		font-size: 12px;
		color: #888;
		border-top: 1px solid #E0DED8;
		max-width: 1200px;
		margin: 0 auto;
	}

	@media (max-width: 768px) {
		.pm-header { padding: 24px 16px 16px; }
		.pm-header h1 { font-size: 22px; }
		.controls-bar { padding: 10px 16px; }
		.controls-bar select { min-width: 140px; }
		.main-content { padding: 16px; }
		.phase-header { font-size: 15px; padding: 12px 16px; }
		.card-grid { gap: 14px; }
	}
</style>
