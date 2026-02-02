-- CPR Client Portal - Supabase Schema
-- Run this in your Supabase SQL Editor to create required tables
-- NOTE: This schema has already been deployed to the cpr-client-portal project

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Zoho OAuth tokens table
-- Stores OAuth tokens for the admin Zoho CRM connection
-- ============================================================================
CREATE TABLE IF NOT EXISTS zoho_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ NOT NULL,
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Clients table (synced from Zoho CRM Contacts)
-- Stores client information for portal access
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_contact_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT GENERATED ALWAYS AS (COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) STORED,
    phone TEXT,
    company TEXT,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,
    portal_access_enabled BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    zoho_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Projects table (synced from Zoho CRM Deals)
-- Stores project/deal information linked to clients
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_deal_id TEXT UNIQUE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stage TEXT,
    status TEXT DEFAULT 'active',
    amount DECIMAL(12,2),
    start_date DATE,
    expected_completion DATE,
    actual_completion DATE,
    description TEXT,
    zoho_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Project documents table
-- Stores file attachments for projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    category TEXT DEFAULT 'general',
    uploaded_by TEXT,
    zoho_attachment_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Client sessions table for portal authentication
-- Manages client login sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes for common queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_zoho_id ON clients(zoho_contact_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_zoho_id ON projects(zoho_deal_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON client_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON client_sessions(session_token);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE zoho_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Service role bypass (for server-side operations)
CREATE POLICY "Service role full access on zoho_tokens" ON zoho_tokens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on clients" ON clients FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on projects" ON projects FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on project_documents" ON project_documents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on client_sessions" ON client_sessions FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_zoho_tokens_updated_at BEFORE UPDATE ON zoho_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
