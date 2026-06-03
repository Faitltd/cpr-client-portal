import { supabase } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';

const log = createLogger('designer-notes');

/** Fields we cache. Mirrored by the CHECK constraint in the migration. */
export type DesignerNoteField = 'Ball_In_Court' | 'Ball_In_Court_Note';

export interface DesignerNoteRow {
	id: number;
	deal_id: string;
	field: DesignerNoteField;
	value: string | null;
	edited_by: string | null;
	edited_at: string;
	pushed_to_zoho_at: string | null;
	push_error: string | null;
}

/**
 * Insert a new edit. The trigger trims to last 5 per (deal_id, field).
 * Returns the newly inserted row.
 */
export async function recordDesignerNoteEdit(
	dealId: string,
	field: DesignerNoteField,
	value: string | null,
	editedBy: string | null
): Promise<DesignerNoteRow> {
	const { data, error } = await supabase
		.from('designer_notes')
		.insert({
			deal_id: dealId,
			field,
			value: value ?? null,
			edited_by: editedBy
		})
		.select()
		.single();
	if (error) {
		log.error('recordDesignerNoteEdit failed', { dealId, field, error: error.message });
		throw new Error(`designer-notes insert failed: ${error.message}`);
	}
	return data as DesignerNoteRow;
}

/**
 * Mark a row as successfully pushed to Zoho. Clears any prior push_error.
 */
export async function markDesignerNotePushed(id: number): Promise<void> {
	const { error } = await supabase
		.from('designer_notes')
		.update({
			pushed_to_zoho_at: new Date().toISOString(),
			push_error: null
		})
		.eq('id', id);
	if (error) {
		log.warn('markDesignerNotePushed failed', { id, error: error.message });
	}
}

/**
 * Record that a Zoho push failed. We keep the row; the value is durable.
 */
export async function markDesignerNotePushError(id: number, message: string): Promise<void> {
	const { error } = await supabase
		.from('designer_notes')
		.update({ push_error: message.slice(0, 500) })
		.eq('id', id);
	if (error) {
		log.warn('markDesignerNotePushError failed', { id, error: error.message });
	}
}

/**
 * Latest cached value per field for a single deal. Returns a map keyed by field.
 */
export async function getLatestDesignerNotes(
	dealId: string
): Promise<Partial<Record<DesignerNoteField, DesignerNoteRow>>> {
	const { data, error } = await supabase
		.from('designer_notes')
		.select('*')
		.eq('deal_id', dealId)
		.order('edited_at', { ascending: false });
	if (error) {
		log.warn('getLatestDesignerNotes failed', { dealId, error: error.message });
		return {};
	}
	const out: Partial<Record<DesignerNoteField, DesignerNoteRow>> = {};
	for (const row of (data ?? []) as DesignerNoteRow[]) {
		if (!out[row.field]) out[row.field] = row;
	}
	return out;
}

/**
 * Latest cached values for a list of deals — one query. Returns a Map keyed
 * by `${dealId}::${field}`.
 */
export async function getLatestDesignerNotesBulk(
	dealIds: string[]
): Promise<Map<string, DesignerNoteRow>> {
	const result = new Map<string, DesignerNoteRow>();
	if (dealIds.length === 0) return result;
	const { data, error } = await supabase
		.from('designer_notes')
		.select('*')
		.in('deal_id', dealIds)
		.order('edited_at', { ascending: false });
	if (error) {
		log.warn('getLatestDesignerNotesBulk failed', { error: error.message });
		return result;
	}
	for (const row of (data ?? []) as DesignerNoteRow[]) {
		const key = `${row.deal_id}::${row.field}`;
		if (!result.has(key)) result.set(key, row);
	}
	return result;
}

/**
 * All rows for a deal that haven't been pushed to Zoho yet (or whose last push
 * predates the most recent edit — meaning a newer edit overrides an older push).
 */
export async function getPendingPushesForDeal(dealId: string): Promise<DesignerNoteRow[]> {
	const latest = await getLatestDesignerNotes(dealId);
	const pending: DesignerNoteRow[] = [];
	for (const row of Object.values(latest)) {
		if (!row) continue;
		if (!row.pushed_to_zoho_at) {
			pending.push(row);
			continue;
		}
		// Newer edit since last push.
		if (new Date(row.edited_at) > new Date(row.pushed_to_zoho_at)) {
			pending.push(row);
		}
	}
	return pending;
}

/**
 * Trigger the daily cleanup. Safe to call from anywhere — it's idempotent.
 */
export async function purgeOldDesignerNotes(): Promise<number> {
	const { data, error } = await supabase.rpc('designer_notes_purge_old');
	if (error) {
		log.warn('purgeOldDesignerNotes failed', { error: error.message });
		return 0;
	}
	return typeof data === 'number' ? data : 0;
}
