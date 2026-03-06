-- Crew daily field reports
-- Trade partners submit end-of-day logs for each project

CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  trade_partner_id UUID REFERENCES trade_partners(id),
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours_worked NUMERIC,
  work_completed TEXT,
  work_planned TEXT,
  issues_encountered TEXT,
  photo_ids TEXT[],
    -- references to WorkDrive file IDs
  weather_delay BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate logs for same trade partner + deal + date
CREATE UNIQUE INDEX idx_daily_logs_unique ON daily_logs(deal_id, trade_partner_id, log_date);

-- Indexes
CREATE INDEX idx_daily_logs_deal_id ON daily_logs(deal_id);
CREATE INDEX idx_daily_logs_date ON daily_logs(log_date DESC);

-- RLS
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON daily_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-update timestamp trigger
CREATE TRIGGER update_daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE daily_logs IS 'Crew daily field reports submitted by trade partners';
