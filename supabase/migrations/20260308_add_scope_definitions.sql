CREATE TABLE IF NOT EXISTS scope_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL UNIQUE,
  project_type TEXT NOT NULL,
  areas JSONB DEFAULT '[]',
  included_items JSONB DEFAULT '[]',
  excluded_items JSONB DEFAULT '[]',
  selections_needed JSONB DEFAULT '[]',
  permit_required BOOLEAN DEFAULT false,
  long_lead_items JSONB DEFAULT '[]',
  special_conditions JSONB DEFAULT '{}',
  trade_notes TEXT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scope_definitions_deal_id ON scope_definitions(deal_id);
CREATE INDEX idx_scope_definitions_status ON scope_definitions(status);
ALTER TABLE scope_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON scope_definitions FOR ALL USING (auth.role() = 'service_role');
CREATE TRIGGER update_scope_definitions_updated_at BEFORE UPDATE ON scope_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
