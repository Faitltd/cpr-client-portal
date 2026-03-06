CREATE TABLE field_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  trade_partner_id UUID REFERENCES trade_partners(id),
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  photo_ids TEXT[],
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_field_issues_deal ON field_issues(deal_id);
CREATE INDEX idx_field_issues_status ON field_issues(status);
