CREATE TABLE IF NOT EXISTS api_response_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  response_json jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '5 minutes'),
  stale_at timestamptz DEFAULT (now() + interval '2 minutes')
);

CREATE INDEX idx_api_cache_key ON api_response_cache (cache_key);
CREATE INDEX idx_api_cache_expires ON api_response_cache (expires_at);

ALTER TABLE api_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON api_response_cache
  FOR ALL USING (auth.role() = 'service_role');
