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

CREATE INDEX idx_generation_log_deal_id ON generation_log(deal_id);
CREATE INDEX idx_generation_log_status ON generation_log(status);
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON generation_log FOR ALL USING (auth.role() = 'service_role');
