-- Shared per-deal progress for the Home Building Checklist on the trade side
-- (trade partners + ops). One row per (deal_id, checklist_key); all authorized
-- trade users read and update the same list.
CREATE TABLE IF NOT EXISTS trade_checklist_progress (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	deal_id text NOT NULL,
	checklist_key text NOT NULL DEFAULT 'residential_build_v1',
	checked_item_ids text[] NOT NULL DEFAULT '{}',
	updated_by text,
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (deal_id, checklist_key)
);

CREATE INDEX IF NOT EXISTS trade_checklist_progress_lookup
	ON trade_checklist_progress (deal_id, checklist_key);
