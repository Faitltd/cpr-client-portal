-- Drop magic-link table (no longer used)
DROP POLICY IF EXISTS "Service role can manage client_login_codes" ON client_login_codes;
DROP INDEX IF EXISTS idx_client_login_codes_token_hash;
DROP TABLE IF EXISTS client_login_codes;
