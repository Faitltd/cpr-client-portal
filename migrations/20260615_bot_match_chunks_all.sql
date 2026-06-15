-- Cross-deal vector match for the admin "Master Bot".
-- Same as bot_match_chunks but WITHOUT the deal_id filter, so the master
-- assistant can retrieve relevant context across every deal's corpus at once.
-- Also returns deal_id so retrieved chunks can be labeled by deal.

CREATE OR REPLACE FUNCTION public.bot_match_chunks_all(p_query_embedding vector, p_k integer DEFAULT 16)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  deal_id text,
  content text,
  source text,
  subject text,
  author text,
  occurred_at timestamp with time zone,
  source_url text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $function$
    SELECT
        c.id AS chunk_id,
        d.id AS document_id,
        c.deal_id,
        c.content,
        d.source,
        d.subject,
        d.author,
        d.occurred_at,
        d.source_url,
        1 - (c.embedding <=> p_query_embedding) AS similarity
    FROM bot_chunks c
    JOIN bot_documents d ON d.id = c.document_id
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_k;
$function$;
