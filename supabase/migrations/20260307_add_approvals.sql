-- Centralized approval/decision tracking
-- Tracks all items requiring client or admin approval across projects

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
    -- 'selection' | 'change_order' | 'design' | 'schedule' | 'budget' | 'general'
  assigned_to TEXT NOT NULL DEFAULT 'client',
    -- 'client' | 'admin'
  status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected' | 'deferred'
  priority TEXT NOT NULL DEFAULT 'normal',
    -- 'low' | 'normal' | 'high' | 'urgent'
  due_date DATE,
  responded_at TIMESTAMPTZ,
  response_note TEXT,
  created_by TEXT,
    -- 'admin' | 'system' | 'crew'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_approvals_deal_id ON approvals(deal_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_assigned ON approvals(assigned_to, status);

-- RLS
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON approvals
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-update timestamp trigger
CREATE TRIGGER update_approvals_updated_at
  BEFORE UPDATE ON approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE approvals IS 'Centralized approval/decision tracking across projects';
