-- CPR Client Portal Schema for Supabase
-- Run this in your Supabase SQL Editor to create required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Portal Users table
CREATE TABLE IF NOT EXISTS portal_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_contact_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Portal Sessions table
CREATE TABLE IF NOT EXISTS portal_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    zoho_contact_id TEXT NOT NULL,
    access_token TEXT NOT NULL, -- Consider encrypting in production
    refresh_token TEXT NOT NULL, -- Consider encrypting in production
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_portal_users_zoho_contact_id ON portal_users(zoho_contact_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(email);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_user_id ON portal_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_zoho_contact_id ON portal_sessions(zoho_contact_id);

-- Enable Row Level Security (RLS)
ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;

-- Create policies for service role access (your backend)
-- This allows your SvelteKit backend to access all rows
CREATE POLICY "Service role can manage portal_users"
    ON portal_users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage portal_sessions"
    ON portal_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_portal_users_updated_at
    BEFORE UPDATE ON portal_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_portal_sessions_updated_at
    BEFORE UPDATE ON portal_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE portal_users IS 'Stores CPR client portal user information linked to Zoho CRM Contacts';
COMMENT ON TABLE portal_sessions IS 'Manages active portal sessions with Zoho OAuth tokens';
COMMENT ON COLUMN portal_sessions.access_token IS 'TODO: Encrypt before production deployment';
COMMENT ON COLUMN portal_sessions.refresh_token IS 'TODO: Encrypt before production deployment';