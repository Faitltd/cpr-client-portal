-- Communication tracking for SLA monitoring
-- Logs every outbound client communication to measure responsiveness

CREATE TABLE IF NOT EXISTS comms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
    -- 'outbound' | 'inbound'
  channel TEXT NOT NULL,
    -- 'email' | 'phone' | 'text' | 'portal' | 'in_person'
  subject TEXT,
  summary TEXT,
  contacted_by TEXT,
    -- admin name or 'system'
  sla_target_hours INTEGER DEFAULT 48,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_comms_log_deal_id ON comms_log(deal_id);
CREATE INDEX idx_comms_log_created_at ON comms_log(deal_id, created_at DESC);

-- RLS
ALTER TABLE comms_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON comms_log
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE comms_log IS 'Communication log for tracking client update SLA compliance';
