CREATE TABLE procurement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT,
    -- 'material' | 'fixture' | 'appliance' | 'custom'
  status TEXT NOT NULL DEFAULT 'needed',
    -- 'needed' | 'approved' | 'ordered' | 'shipped' | 'delivered' | 'delayed' | 'damaged' | 'installed'
  vendor TEXT,
  cost NUMERIC,
  lead_time_days INTEGER,
  expected_date DATE,
  actual_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE procurement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON procurement_items
  FOR ALL TO service_role USING (true);

CREATE INDEX idx_procurement_items_deal_id ON procurement_items(deal_id);
CREATE INDEX idx_procurement_items_status ON procurement_items(status);
