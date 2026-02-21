CREATE TABLE IF NOT EXISTS workdrive_folder_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id text NOT NULL,
  folder_type text NOT NULL DEFAULT 'root',
  folder_id text NOT NULL,
  folder_name text,
  resolved_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days')
);

CREATE UNIQUE INDEX idx_wdf_cache_deal_type ON workdrive_folder_cache (deal_id, folder_type);

ALTER TABLE workdrive_folder_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON workdrive_folder_cache
  FOR ALL USING (auth.role() = 'service_role');
