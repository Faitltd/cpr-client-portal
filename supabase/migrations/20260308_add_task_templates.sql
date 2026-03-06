CREATE TABLE IF NOT EXISTS task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type TEXT NOT NULL,
  phase TEXT NOT NULL,
  task_name TEXT NOT NULL,
  trade TEXT,
  description TEXT,
  default_duration_days INTEGER DEFAULT 1,
  dependency_key TEXT,
  requires_inspection BOOLEAN DEFAULT false,
  requires_client_decision BOOLEAN DEFAULT false,
  material_lead_time_days INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_conditional BOOLEAN DEFAULT false,
  condition_key TEXT,
  condition_value TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_task_templates_lookup ON task_templates(project_type, phase, sort_order);
CREATE INDEX idx_task_templates_conditions ON task_templates(condition_key) WHERE is_conditional;
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON task_templates FOR ALL USING (auth.role() = 'service_role');
