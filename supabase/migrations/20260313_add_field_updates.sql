CREATE TABLE field_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  trade_partner_id UUID REFERENCES trade_partners(id),
  update_type TEXT NOT NULL,
  note TEXT,
  photo_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_field_updates_deal ON field_updates(deal_id);
CREATE INDEX idx_field_updates_trade_partner ON field_updates(trade_partner_id);
