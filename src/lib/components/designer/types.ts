export type { DesignerDealSummary, DesignerNote } from '$lib/types/designer';
import type { DesignerNote } from '$lib/types/designer';

export type DealEditState = {
	loadingNotes: boolean;
	notes: DesignerNote[];
	notesError: string;
	composing: boolean;
	composerText: string;
	composerError: string;
	savingFields: boolean;
	fieldsError: string;
	fieldsDirty: Record<string, unknown>;
	fieldsSavedAt: number | null;
};
