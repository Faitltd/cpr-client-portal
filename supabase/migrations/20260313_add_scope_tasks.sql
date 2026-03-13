CREATE TABLE scope_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'rough',
  trade TEXT,
  description TEXT,
  duration_days INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  requires_inspection BOOLEAN DEFAULT false,
  requires_client_decision BOOLEAN DEFAULT false,
  dependency_id UUID REFERENCES scope_tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scope_tasks_deal ON scope_tasks(deal_id);
ALTER TABLE scope_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON scope_tasks FOR ALL USING (auth.role() = 'service_role');
