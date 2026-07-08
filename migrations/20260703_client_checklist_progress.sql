-- Per-client progress for the residential building checklist shown in the
-- homeowner dashboard. One row per (client_email, deal_id, checklist_key);
-- checked_item_ids holds the ids the client has ticked off.
CREATE TABLE IF NOT EXISTS client_checklist_progress (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	client_email text NOT NULL,
	deal_id text NOT NULL,
	checklist_key text NOT NULL DEFAULT 'residential_build_v1',
	checked_item_ids text[] NOT NULL DEFAULT '{}',
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (client_email, deal_id, checklist_key)
);

CREATE INDEX IF NOT EXISTS client_checklist_progress_lookup
	ON client_checklist_progress (client_email, deal_id, checklist_key);
