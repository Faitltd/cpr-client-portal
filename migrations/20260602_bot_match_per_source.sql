-- Per-source semantic match: returns top-K chunks PER source, so noisy sources
-- (Cliq with 1000+ msgs) don't crowd out smaller sources (Books, WorkDrive).

CREATE OR REPLACE FUNCTION bot_match_chunks_per_source(
    p_deal_id TEXT,
    p_query_embedding VECTOR(1536),
    p_per_source INT DEFAULT 3
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
    WITH ranked AS (
        SELECT
            c.id AS chunk_id,
            d.id AS document_id,
            c.content,
            d.source,
            d.subject,
            d.author,
            d.occurred_at,
            d.source_url,
            1 - (c.embedding <=> p_query_embedding) AS similarity,
            ROW_NUMBER() OVER (
                PARTITION BY d.source
                ORDER BY c.embedding <=> p_query_embedding
            ) AS rn
        FROM bot_chunks c
        JOIN bot_documents d ON d.id = c.document_id
        WHERE c.deal_id = p_deal_id
    )
    SELECT
        chunk_id, document_id, content, source, subject, author,
        occurred_at, source_url, similarity
    FROM ranked
    WHERE rn <= p_per_source
    ORDER BY similarity DESC;
$$;
