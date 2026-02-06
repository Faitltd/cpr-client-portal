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

CREATE INDEX IF NOT EXISTS idx_salesiq_conversations_client_id ON salesiq_conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_salesiq_conversations_channel_id ON salesiq_conversations(cliq_channel_id);

ALTER TABLE salesiq_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliq_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_cliq_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesiq_conversations ENABLE ROW LEVEL SECURITY;

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

COMMENT ON TABLE salesiq_tokens IS 'Stores Zoho SalesIQ OAuth tokens';
COMMENT ON TABLE cliq_tokens IS 'Stores Zoho Cliq OAuth tokens';
COMMENT ON TABLE client_cliq_channels IS 'Maps clients to Cliq channels';
COMMENT ON TABLE salesiq_conversations IS 'Maps SalesIQ conversations to Cliq channels';
