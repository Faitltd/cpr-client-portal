// Original residential new-home / major-renovation checklist authored for
// Custom Professional Renovations (CPR). Content is CPR's own — general
// building phases and tasks, plus links to public reference resources. Item
// ids are stable strings; never renumber an existing id or saved client
// progress will drift.

export interface ChecklistLink {
	label: string;
	url: string;
}

export interface ChecklistItem {
	id: string;
	text: string;
	hint?: string;
	link?: ChecklistLink;
}

export interface ChecklistPhase {
	id: string;
	title: string;
	summary: string;
	items: ChecklistItem[];
}

export const RESIDENTIAL_CHECKLIST_KEY = 'residential_build_v1';

export const RESIDENTIAL_CHECKLIST: ChecklistPhase[] = [
	{
		id: 'vision',
		title: '1 · Vision & Budget',
		summary: 'Define what you want and what you can spend before anything else.',
		items: [
			{ id: 'vision_must_haves', text: 'List your must-haves, nice-to-haves, and hard "no"s for the home.' },
			{ id: 'vision_lifestyle', text: 'Describe how you actually live day-to-day so the layout fits your household.' },
			{ id: 'vision_total_budget', text: 'Set an all-in budget, including land, construction, permits, and furnishings.' },
			{
				id: 'vision_contingency',
				text: 'Reserve a 10–20% contingency for surprises and change orders.',
				hint: 'Renovations of older homes trend toward the higher end.'
			},
			{ id: 'vision_timeline', text: 'Agree on a realistic move-in target with your CPR project lead.' }
		]
	},
	{
		id: 'financing',
		title: '2 · Financing',
		summary: 'Line up the money and understand how draws are released.',
		items: [
			{
				id: 'fin_prequal',
				text: 'Get pre-qualified for a construction or renovation loan.',
				link: { label: 'Mortgage basics (CFPB)', url: 'https://www.consumerfinance.gov/owning-a-home/' }
			},
			{ id: 'fin_draw_schedule', text: 'Review the lender draw schedule and how it maps to build milestones.' },
			{ id: 'fin_cash_reserves', text: 'Confirm cash reserves for the down payment, contingency, and closing costs.' },
			{ id: 'fin_insurance', text: 'Arrange builder’s risk insurance and confirm your homeowner policy start date.' }
		]
	},
	{
		id: 'lot',
		title: '3 · Land & Lot',
		summary: 'Make sure the site can support the home you want to build.',
		items: [
			{ id: 'lot_zoning', text: 'Verify zoning, setbacks, and any HOA or deed restrictions with the local office.' },
			{ id: 'lot_utilities', text: 'Confirm water, sewer/septic, power, and internet availability at the lot.' },
			{ id: 'lot_survey', text: 'Order a boundary and topographic survey.' },
			{ id: 'lot_soil', text: 'Schedule a soil / geotechnical test where foundations or grading are a concern.' },
			{ id: 'lot_access', text: 'Check driveway access, drainage, and any trees or features to keep or remove.' }
		]
	},
	{
		id: 'team',
		title: '4 · Team & Contract',
		summary: 'Get the right people and clear paperwork in place.',
		items: [
			{ id: 'team_scope', text: 'Finalize the scope of work with CPR so everyone shares one definition of "done".' },
			{ id: 'team_contract', text: 'Review and sign the construction contract, including payment terms.' },
			{ id: 'team_allowances', text: 'Understand allowances for finishes and how overages are handled.' },
			{ id: 'team_comms', text: 'Agree on how updates, decisions, and approvals flow through the portal.' }
		]
	},
	{
		id: 'design',
		title: '5 · Design & Plans',
		summary: 'Turn the vision into buildable drawings.',
		items: [
			{ id: 'design_floorplan', text: 'Approve the floor plan and room dimensions.' },
			{ id: 'design_elevations', text: 'Review exterior elevations and rooflines.' },
			{ id: 'design_electrical_plan', text: 'Walk the electrical plan: outlets, switches, lighting, and data drops.' },
			{ id: 'design_structural', text: 'Confirm structural and engineering details are stamped where required.' },
			{
				id: 'design_energy',
				text: 'Set energy-efficiency targets for insulation, windows, and HVAC.',
				link: { label: 'ENERGY STAR new homes', url: 'https://www.energystar.gov/newhomes' }
			}
		]
	},
	{
		id: 'permits',
		title: '6 · Permits & Approvals',
		summary: 'Nothing structural starts until this is cleared.',
		items: [
			{ id: 'permit_building', text: 'Submit for and receive the building permit.' },
			{ id: 'permit_trades', text: 'Confirm electrical, plumbing, and mechanical permits are pulled.' },
			{ id: 'permit_inspection_plan', text: 'Note the required inspection points so the schedule accounts for them.' },
			{
				id: 'permit_codes',
				text: 'Confirm which building code edition your jurisdiction enforces.',
				link: { label: 'ICC code adoption map', url: 'https://www.iccsafe.org/advocacy/code-adoption-maps/' }
			}
		]
	},
	{
		id: 'selections',
		title: '7 · Selections & Materials',
		summary: 'Lock in choices early so they don’t stall the build.',
		items: [
			{ id: 'sel_kitchen', text: 'Choose cabinets, countertops, and kitchen appliances.' },
			{ id: 'sel_flooring', text: 'Select flooring for each area.' },
			{ id: 'sel_plumbing_fixtures', text: 'Pick plumbing fixtures, faucets, and the water heater type.' },
			{ id: 'sel_lighting', text: 'Choose light fixtures and confirm quantities against the electrical plan.' },
			{ id: 'sel_paint', text: 'Finalize interior and exterior paint colors.' },
			{ id: 'sel_long_lead', text: 'Order long-lead items (windows, custom doors, specialty tile) well ahead of need.' }
		]
	},
	{
		id: 'foundation',
		title: '8 · Site Prep & Foundation',
		summary: 'The ground work everything else stands on.',
		items: [
			{ id: 'found_clearing', text: 'Clear and grade the site; set erosion controls.' },
			{ id: 'found_stakeout', text: 'Stake out the home footprint and confirm it against the survey.' },
			{ id: 'found_footings', text: 'Pour footings and foundation; pass the foundation inspection.' },
			{ id: 'found_waterproof', text: 'Waterproof and add drainage before backfilling.' },
			{ id: 'found_underslab', text: 'Rough-in under-slab plumbing and any conduit before the slab pours.' }
		]
	},
	{
		id: 'framing',
		title: '9 · Framing & Dry-In',
		summary: 'The house takes shape and gets weather-tight.',
		items: [
			{ id: 'frame_walls', text: 'Frame floors, walls, and roof; confirm rooms feel right in person.' },
			{ id: 'frame_windows_doors', text: 'Set windows and exterior doors.' },
			{ id: 'frame_roof', text: 'Dry-in the roof so the interior is protected.' },
			{ id: 'frame_inspection', text: 'Pass the framing inspection before anything is covered.' }
		]
	},
	{
		id: 'roughins',
		title: '10 · Rough-Ins',
		summary: 'Everything that hides inside the walls.',
		items: [
			{ id: 'rough_plumbing', text: 'Complete plumbing rough-in.' },
			{ id: 'rough_electrical', text: 'Complete electrical rough-in; confirm outlet and switch locations on-site.' },
			{ id: 'rough_hvac', text: 'Install HVAC ducting and equipment.' },
			{ id: 'rough_lowvoltage', text: 'Run low-voltage: data, security, and any smart-home wiring.' },
			{ id: 'rough_inspection', text: 'Pass rough-in inspections for each trade.' }
		]
	},
	{
		id: 'closein',
		title: '11 · Insulation & Drywall',
		summary: 'Sealing up and creating finished surfaces.',
		items: [
			{ id: 'close_insulation', text: 'Install insulation and air-seal; pass the insulation inspection.' },
			{ id: 'close_drywall', text: 'Hang, tape, and finish drywall.' },
			{ id: 'close_prime', text: 'Prime walls and ceilings.' }
		]
	},
	{
		id: 'finishes',
		title: '12 · Interior Finishes',
		summary: 'The details you see and touch every day.',
		items: [
			{ id: 'fin_trim', text: 'Install interior doors, trim, and millwork.' },
			{ id: 'fin_cabinets', text: 'Set cabinets and countertops.' },
			{ id: 'fin_flooring', text: 'Install finished flooring.' },
			{ id: 'fin_paint', text: 'Complete finish paint.' },
			{ id: 'fin_fixtures', text: 'Install plumbing fixtures, light fixtures, and hardware.' },
			{ id: 'fin_appliances', text: 'Install and test appliances.' }
		]
	},
	{
		id: 'exterior',
		title: '13 · Exterior & Landscaping',
		summary: 'Finishing the shell and the grounds.',
		items: [
			{ id: 'ext_siding', text: 'Complete siding, brick, or stucco.' },
			{ id: 'ext_gutters', text: 'Install gutters and downspouts; confirm they carry water away from the foundation.' },
			{ id: 'ext_driveway', text: 'Pour driveway, walkways, and any patios.' },
			{ id: 'ext_grading', text: 'Final grade for drainage and add landscaping.' }
		]
	},
	{
		id: 'closeout',
		title: '14 · Final Inspections & Move-In',
		summary: 'Proving the home is done and safe to occupy.',
		items: [
			{ id: 'close_punch', text: 'Walk the home with CPR and build the punch list.' },
			{ id: 'close_final_inspection', text: 'Pass the final building inspection.' },
			{ id: 'close_co', text: 'Receive the Certificate of Occupancy.' },
			{ id: 'close_cleaning', text: 'Complete final cleaning.' },
			{ id: 'close_walkthrough', text: 'Do the final walkthrough and confirm the punch list is closed.' }
		]
	},
	{
		id: 'warranty',
		title: '15 · After Move-In',
		summary: 'Settling in and protecting your investment.',
		items: [
			{ id: 'warr_manuals', text: 'Collect appliance manuals, warranties, and paint/finish records.' },
			{ id: 'warr_maintenance', text: 'Set a seasonal maintenance schedule (HVAC filters, gutters, caulk, sealants).' },
			{
				id: 'warr_energy_check',
				text: 'Consider a post-build energy assessment to fine-tune comfort and bills.',
				link: { label: 'Home energy tips (DOE)', url: 'https://www.energy.gov/energysaver/energy-saver' }
			},
			{ id: 'warr_followup', text: 'Note any warranty items and report them to CPR before the warranty window closes.' }
		]
	}
];

export function totalChecklistItems(phases: ChecklistPhase[] = RESIDENTIAL_CHECKLIST): number {
	return phases.reduce((sum, p) => sum + p.items.length, 0);
}
