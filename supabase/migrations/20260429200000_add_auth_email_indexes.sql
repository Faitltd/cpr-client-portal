-- Ensure exact-match indexes exist on all three auth tables
CREATE INDEX IF NOT EXISTS idx_trade_partners_email
  ON trade_partners (email);

CREATE INDEX IF NOT EXISTS idx_clients_email
  ON clients (email);

CREATE INDEX IF NOT EXISTS idx_designers_email
  ON designers (email);
