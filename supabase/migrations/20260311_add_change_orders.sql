CREATE TABLE change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  estimated_amount NUMERIC,
  approved_amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'identified',
    -- 'identified' | 'scoped' | 'sent' | 'approved' | 'billed' | 'rejected'
  identified_by TEXT,
  identified_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  billed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON change_orders
  FOR ALL TO service_role USING (true);

CREATE INDEX idx_change_orders_deal_id ON change_orders(deal_id);
CREATE INDEX idx_change_orders_status ON change_orders(status);
