/**
 * Shared designer domain types. Imported by both the Zoho-backed server layer
 * (`$lib/server/designer`) and the Svelte UI components so the wire format
 * matches what the dashboard renders.
 */

export type DesignerNote = {
	id: string;
	Note_Title: string | null;
	Note_Content: string | null;
	Created_Time: string | null;
	Modified_Time: string | null;
	owner_name: string | null;
};

export type DesignerDealSummary = {
	id: string;
	name: string;
	stage: string | null;
	contactName: string | null;
	contactId: string | null;
	accountName: string | null;
	accountId: string | null;
	address: string | null;
	ballInCourt: string | null;
	workdriveUrl: string | null;
	modifiedTime: string | null;
	createdTime: string | null;
	/** The full normalized deal record — used to seed editable field inputs. */
	fields: Record<string, unknown>;
};

export type DealsResponse = {
	deals: DesignerDealSummary[];
};

export type NotesResponse = {
	notes: DesignerNote[];
};

export type NoteResponse = {
	note: DesignerNote;
};

export type DealUpdateRequest = {
	fields: Record<string, unknown>;
};

export type DealUpdateResponse = {
	ok: true;
	deal: DesignerDealSummary;
};

export type ApiErrorResponse = {
	message: string;
};

// ---------------------------------------------------------------------------
// Deal field descriptors — the single source of truth for
//   • which fields the API fetches from Zoho
//   • which fields the UI renders (and what kind of control)
//   • which fields the PATCH handler accepts
// "All Deal fields editable" is intentionally scoped to meaningful, business-
// editable fields; audit/system/relational/integration fields are visible
// where useful but never accepted on update.
// ---------------------------------------------------------------------------

export type DealFieldKind =
	| 'text'
	| 'textarea'
	| 'number'
	| 'currency'
	| 'date'
	| 'readonly'
	| 'lookup-readonly';

export type DealFieldGroup = 'core' | 'address' | 'access' | 'scope' | 'system';

export type DealFieldDescriptor = {
	key: string;
	label: string;
	kind: DealFieldKind;
	group: DealFieldGroup;
	editable: boolean;
	helpText?: string;
};

export const DESIGNER_DEAL_FIELD_DESCRIPTORS: readonly DealFieldDescriptor[] = [
	// ── Core business fields ───────────────────────────────────────────────
	{ key: 'Deal_Name', label: 'Deal name', kind: 'text', group: 'core', editable: true },
	{
		key: 'Stage',
		label: 'Stage',
		kind: 'lookup-readonly',
		group: 'core',
		editable: false,
		helpText: 'Changed from the Zoho CRM stage pipeline.'
	},
	{
		key: 'Ball_In_Court',
		label: 'Ball in court',
		kind: 'text',
		group: 'core',
		editable: true,
		helpText: 'Who owns the current action on this deal.'
	},
	{ key: 'Amount', label: 'Amount', kind: 'currency', group: 'core', editable: true },
	{ key: 'Closing_Date', label: 'Closing date', kind: 'date', group: 'core', editable: true },
	{ key: 'Description', label: 'Description', kind: 'textarea', group: 'core', editable: true },

	// ── Scope ──────────────────────────────────────────────────────────────
	{ key: 'Refined_Scope', label: 'Refined scope', kind: 'textarea', group: 'scope', editable: true },

	// ── Address ────────────────────────────────────────────────────────────
	{ key: 'Address', label: 'Address', kind: 'text', group: 'address', editable: true },
	{ key: 'Address_Line_2', label: 'Address line 2', kind: 'text', group: 'address', editable: true },
	{ key: 'Street', label: 'Street', kind: 'text', group: 'address', editable: true },
	{ key: 'City', label: 'City', kind: 'text', group: 'address', editable: true },
	{ key: 'State', label: 'State', kind: 'text', group: 'address', editable: true },
	{ key: 'Zip_Code', label: 'Zip / postal', kind: 'text', group: 'address', editable: true },

	// ── Access / links ────────────────────────────────────────────────────
	{ key: 'Garage_Code', label: 'Garage code', kind: 'text', group: 'access', editable: true },
	{ key: 'WiFi', label: 'Wi-Fi', kind: 'text', group: 'access', editable: true },
	{
		key: 'Client_Portal_Folder',
		label: 'WorkDrive folder URL',
		kind: 'text',
		group: 'access',
		editable: true,
		helpText: 'Full https:// URL to the Deal WorkDrive folder.'
	},
	{ key: 'External_Link', label: 'External link', kind: 'text', group: 'access', editable: true },

	// ── System / relational (visible, read-only) ───────────────────────────
	{
		key: 'Contact_Name',
		label: 'Primary contact',
		kind: 'lookup-readonly',
		group: 'system',
		editable: false
	},
	{
		key: 'Account_Name',
		label: 'Account',
		kind: 'lookup-readonly',
		group: 'system',
		editable: false
	},
	{ key: 'Owner', label: 'Owner', kind: 'lookup-readonly', group: 'system', editable: false },
	{ key: 'Created_Time', label: 'Created', kind: 'readonly', group: 'system', editable: false },
	{ key: 'Modified_Time', label: 'Modified', kind: 'readonly', group: 'system', editable: false }
];

/** Fields the API pulls from Zoho — descriptor keys plus extras needed for
 * display-side logic (WorkDrive resolver, attachment indicators, integration
 * IDs that drive link-outs). None of the extras are rendered as editable. */
export const DESIGNER_FETCH_FIELD_KEYS: readonly string[] = [
	...DESIGNER_DEAL_FIELD_DESCRIPTORS.map((d) => d.key),
	'File_Upload',
	'Progress_Photos',
	'Portal_Trade_Partners',
	'Project_ID',
	'Zoho_Projects_ID'
];

/** Whitelist of keys the PATCH handler will forward to Zoho. */
export const EDITABLE_DEAL_FIELD_KEYS: ReadonlySet<string> = new Set(
	DESIGNER_DEAL_FIELD_DESCRIPTORS.filter((d) => d.editable).map((d) => d.key)
);
