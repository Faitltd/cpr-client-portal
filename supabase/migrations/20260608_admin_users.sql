-- Migration: admin_users
-- Per-user admin accounts (email + hashed password) for /admin/login.
-- Coexists with the env-based PORTAL_ADMIN_EMAIL(S)/PORTAL_ADMIN_PASSWORD login:
-- a login succeeds if it matches the env admin OR an active admin_users row.

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage admin_users"
    ON admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
