-- Bot chat persistence: threads + messages
-- Phase 1 of CRM bot build plan

CREATE TABLE IF NOT EXISTS bot_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_threads_deal_last_msg
    ON bot_threads (deal_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_threads_admin
    ON bot_threads (admin_email, last_message_at DESC);

CREATE TABLE IF NOT EXISTS bot_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id TEXT,
    citations JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_messages_thread_created
    ON bot_messages (thread_id, created_at);
