-- Transcoding job queue for background video processing
CREATE TABLE IF NOT EXISTS transcoding_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_update_id UUID,
  original_path   TEXT        NOT NULL,
  output_path     TEXT,
  zoho_record_id  TEXT,
  zoho_module     TEXT        NOT NULL DEFAULT 'Field_Updates',
  status          TEXT        NOT NULL DEFAULT 'pending',
  error           TEXT,
  attempts        INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcoding_jobs_status_created
  ON transcoding_jobs (status, created_at);
