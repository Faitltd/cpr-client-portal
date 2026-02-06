-- CPR Client Portal Schema for Supabase
-- Run this in your Supabase SQL Editor to create required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Zoho admin tokens (optional, for background sync jobs)
CREATE TABLE IF NOT EXISTS zoho_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Clients (Zoho Contacts with portal access)
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_contact_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT GENERATED ALWAYS AS (
        NULLIF(trim(concat_ws(' ', first_name, last_name)), '')
    ) STORED,
    company TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Projects (Zoho Deals)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_deal_id TEXT UNIQUE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stage TEXT,
    amount NUMERIC,
    closing_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Project documents (Zoho Attachments)
CREATE TABLE IF NOT EXISTS project_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    zoho_attachment_id TEXT UNIQUE,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    file_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Client sessions
CREATE TABLE IF NOT EXISTS client_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token TEXT UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trade partners
CREATE TABLE IF NOT EXISTS trade_partners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zoho_trade_partner_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    company TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trade partner sessions
CREATE TABLE IF NOT EXISTS trade_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token TEXT UNIQUE NOT NULL,
    trade_partner_id UUID NOT NULL REFERENCES trade_partners(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SalesIQ OAuth tokens
CREATE TABLE IF NOT EXISTS salesiq_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cliq OAuth tokens
CREATE TABLE IF NOT EXISTS cliq_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-client Cliq channel mapping
CREATE TABLE IF NOT EXISTS client_cliq_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    cliq_channel_id TEXT NOT NULL,
    cliq_channel_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id),
    UNIQUE (cliq_channel_id)
);

-- SalesIQ conversation mapping
CREATE TABLE IF NOT EXISTS salesiq_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id TEXT UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    cliq_channel_id TEXT NOT NULL,
    last_event_time TIMESTAMP WITH TIME ZONE,
    last_visitor_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_zoho_contact_id ON clients(zoho_contact_id);
CREATE INDEX IF NOT EXISTS idx_projects_zoho_deal_id ON projects(zoho_deal_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_client_sessions_session_token ON client_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_client_sessions_client_id ON client_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_trade_partners_email ON trade_partners(email);
CREATE INDEX IF NOT EXISTS idx_trade_partners_zoho_id ON trade_partners(zoho_trade_partner_id);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_session_token ON trade_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_partner_id ON trade_sessions(trade_partner_id);
CREATE INDEX IF NOT EXISTS idx_salesiq_conversations_client_id ON salesiq_conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_salesiq_conversations_channel_id ON salesiq_conversations(cliq_channel_id);

-- Enable Row Level Security (RLS)
ALTER TABLE zoho_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesiq_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliq_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_cliq_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesiq_conversations ENABLE ROW LEVEL SECURITY;

-- Create policies for service role access (your backend)
CREATE POLICY "Service role can manage zoho_tokens"
    ON zoho_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage clients"
    ON clients
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage projects"
    ON projects
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage project_documents"
    ON project_documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage client_sessions"
    ON client_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage trade_partners"
    ON trade_partners
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage trade_sessions"
    ON trade_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage salesiq_tokens"
    ON salesiq_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage cliq_tokens"
    ON cliq_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage client_cliq_channels"
    ON client_cliq_channels
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can manage salesiq_conversations"
    ON salesiq_conversations
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
CREATE TRIGGER update_zoho_tokens_updated_at
    BEFORE UPDATE ON zoho_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trade_partners_updated_at
    BEFORE UPDATE ON trade_partners
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salesiq_tokens_updated_at
    BEFORE UPDATE ON salesiq_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cliq_tokens_updated_at
    BEFORE UPDATE ON cliq_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_client_cliq_channels_updated_at
    BEFORE UPDATE ON client_cliq_channels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salesiq_conversations_updated_at
    BEFORE UPDATE ON salesiq_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE zoho_tokens IS 'Stores Zoho OAuth tokens for background sync jobs';
COMMENT ON TABLE clients IS 'Stores CPR clients linked to Zoho CRM Contacts';
COMMENT ON TABLE projects IS 'Stores projects linked to Zoho CRM Deals';
COMMENT ON TABLE project_documents IS 'Stores documents linked to projects';
COMMENT ON TABLE client_sessions IS 'Manages active portal sessions';
COMMENT ON TABLE trade_partners IS 'Stores trade partner accounts';
COMMENT ON TABLE trade_sessions IS 'Manages active trade partner sessions';
COMMENT ON TABLE salesiq_tokens IS 'Stores Zoho SalesIQ OAuth tokens';
COMMENT ON TABLE cliq_tokens IS 'Stores Zoho Cliq OAuth tokens';
COMMENT ON TABLE client_cliq_channels IS 'Maps clients to Cliq channels';
COMMENT ON TABLE salesiq_conversations IS 'Maps SalesIQ conversations to Cliq channels';
