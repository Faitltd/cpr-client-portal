-- Migration: designer_portal
-- Source: PR #20 body ("Migration — apply before deploy")
-- Squash commit: c922979  PR: https://github.com/Faitltd/cpr-client-portal/pull/20
-- Applied: 2026-04-16

CREATE TABLE IF NOT EXISTS designers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS designer_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token TEXT UNIQUE NOT NULL,
    designer_id UUID NOT NULL REFERENCES designers(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_designers_email ON designers(email);
CREATE INDEX IF NOT EXISTS idx_designer_sessions_token ON designer_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_designer_sessions_designer_id ON designer_sessions(designer_id);

ALTER TABLE designers ENABLE ROW LEVEL SECURITY;
ALTER TABLE designer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage designers"
    ON designers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage designer_sessions"
    ON designer_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_designers_updated_at
    BEFORE UPDATE ON designers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
