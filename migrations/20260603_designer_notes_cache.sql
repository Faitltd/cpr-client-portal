-- Designer-portal cache for Ball_In_Court and Ball_In_Court_Note edits.
--
-- Rationale: designers edit these two fields constantly from the portal. When
-- Zoho is unreachable (token expired, rate-limited, transient 5xx) the edit
-- used to be lost. This table is the durable copy. Every edit lands here first,
-- then we attempt a Zoho push. A manual "Push to Zoho" button can retry any
-- rows where `pushed_to_zoho_at IS NULL` or older than `edited_at`.
--
-- Retention: trigger trims each (deal_id, field) to the latest 5 versions,
-- and a daily job (or cron-triggered cleanup) purges rows older than 90 days.

CREATE TABLE IF NOT EXISTS designer_notes (
  id            bigserial PRIMARY KEY,
  deal_id       text NOT NULL,
  field         text NOT NULL CHECK (field IN ('Ball_In_Court', 'Ball_In_Court_Note')),
  value         text,
  edited_by     text,
  edited_at     timestamptz NOT NULL DEFAULT now(),
  pushed_to_zoho_at timestamptz,
  push_error    text
);

CREATE INDEX IF NOT EXISTS idx_designer_notes_deal_field_time
  ON designer_notes (deal_id, field, edited_at DESC);

CREATE INDEX IF NOT EXISTS idx_designer_notes_pending_push
  ON designer_notes (deal_id)
  WHERE pushed_to_zoho_at IS NULL;

-- Trim history to last 5 per (deal_id, field) after each insert.
CREATE OR REPLACE FUNCTION designer_notes_trim_history()
RETURNS trigger AS $$
BEGIN
  DELETE FROM designer_notes
  WHERE deal_id = NEW.deal_id
    AND field = NEW.field
    AND id NOT IN (
      SELECT id
      FROM designer_notes
      WHERE deal_id = NEW.deal_id AND field = NEW.field
      ORDER BY edited_at DESC
      LIMIT 5
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS designer_notes_trim_history_trg ON designer_notes;
CREATE TRIGGER designer_notes_trim_history_trg
  AFTER INSERT ON designer_notes
  FOR EACH ROW EXECUTE FUNCTION designer_notes_trim_history();

-- Purge rows older than 90 days. Call from a daily cron or sync job.
CREATE OR REPLACE FUNCTION designer_notes_purge_old()
RETURNS integer AS $$
DECLARE
  removed integer;
BEGIN
  WITH del AS (
    DELETE FROM designer_notes
    WHERE edited_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;
