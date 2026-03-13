-- Re-issued migration for generation_log table (original: 20260309).
-- Safe to run if the table already exists thanks to IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  scope_definition_id UUID REFERENCES scope_definitions(id),
  status TEXT NOT NULL DEFAULT 'started',
  zoho_project_id TEXT,
  phases_created INTEGER DEFAULT 0,
  tasklists_created INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  tasks_total INTEGER DEFAULT 0,
  last_completed_step TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_log_deal_id ON generation_log(deal_id);
CREATE INDEX IF NOT EXISTS idx_generation_log_status ON generation_log(status);
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'generation_log' AND policyname = 'Service role only'
  ) THEN
    CREATE POLICY "Service role only" ON generation_log FOR ALL USING (auth.role() = 'service_role');
  END IF;
END
$$;
