-- Phase 2A: comms ingestion corpus
-- bot_documents (source-of-truth rows), bot_chunks (embedded fragments),
-- bot_ingest_cursors (per-source watermark), bot_match_chunks() RPC.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS bot_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN (
        'zoho_mail',
        'zoho_cliq_internal',
        'zoho_cliq_external',
        'zoho_crm_note',
        'zoho_crm_field',
        'transcript',
        'sms'
    )),
    source_id TEXT NOT NULL,
    source_url TEXT,
    author TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_documents_deal_occurred
    ON bot_documents (deal_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_documents_source_occurred
    ON bot_documents (source, occurred_at DESC);

CREATE TABLE IF NOT EXISTS bot_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES bot_documents(id) ON DELETE CASCADE,
    deal_id TEXT NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_chunks_deal ON bot_chunks (deal_id);
CREATE INDEX IF NOT EXISTS idx_bot_chunks_document ON bot_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_bot_chunks_embedding
    ON bot_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS bot_ingest_cursors (
    source TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (source, deal_id)
);

CREATE OR REPLACE FUNCTION bot_match_chunks(
    p_deal_id TEXT,
    p_query_embedding VECTOR(1536),
    p_k INT DEFAULT 12
) RETURNS TABLE (
    chunk_id UUID,
    document_id UUID,
    content TEXT,
    source TEXT,
    subject TEXT,
    author TEXT,
    occurred_at TIMESTAMPTZ,
    source_url TEXT,
    similarity FLOAT
) LANGUAGE SQL STABLE AS $$
    SELECT
        c.id AS chunk_id,
        d.id AS document_id,
        c.content,
        d.source,
        d.subject,
        d.author,
        d.occurred_at,
        d.source_url,
        1 - (c.embedding <=> p_query_embedding) AS similarity
    FROM bot_chunks c
    JOIN bot_documents d ON d.id = c.document_id
    WHERE c.deal_id = p_deal_id
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_k;
$$;
